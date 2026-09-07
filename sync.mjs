import { db } from "./db.mjs";
import { parseICS, mergeFeeds } from "./ical.mjs";

// 案A: チェックインが過ぎた予約（check_in < 今日 = 滞在開始済み）はDBに確定保存して残す。
// これから始まる予約（check_in >= 今日）だけ iCal 最新で入れ替える。
// → 滞在に入った予約は iCal から消えても実績として残る（Booking の消失対策）。
// Booking の手動分割(splits)は読み取り時に適用され、確定済みの生データは
// 二度と上書きされないため、分割済みの件数がそのまま固定される。
export async function runSync() {
  const sql = db();
  const feedRows = await sql`select * from feeds where active = true`;

  const feeds = [];
  const errors = [];
  await Promise.all(
    feedRows.map(async (f) => {
      try {
        const res = await fetch(f.ical_url, { headers: { "User-Agent": "minpaku-board/1.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        feeds.push({
          propertyName: f.property_name,
          area: f.area || "",
          platform: f.platform,
          events: parseICS(text),
        });
      } catch (e) {
        errors.push({ feed: f.property_name + "/" + f.platform, error: String(e.message || e) });
      }
    })
  );

  const merged = mergeFeeds(feeds);
  // 「今日」は日本時間(JST)で判定（UTCだと日本の未明に前日扱いになりズレる）
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().slice(0, 10);

  // 今回“取得に成功した”物件だけを入れ替え対象にする。
  // （iCal取得が失敗した物件は触らない＝一時的な取得失敗で予約が消えるのを防ぐ）
  const okProps = [...new Set(feeds.map((f) => f.propertyName))];

  // チェックインが明日以降（> 今日）の分だけ iCal で入れ替える。
  // チェックイン <= 今日（当日イン含む＝滞在開始済み/当日）は確定保持し、上書きしない。
  const upToStr = (r) => r.checkIn.toISOString().slice(0, 10);
  const upcoming = merged.filter((r) => upToStr(r) > today);

  // 直前予約対策：チェックインが「今日以前」でも、DBにまだ無い予約は追加する。
  // （当日・前日に確定してiCalに出た予約は、保持側に回って挿入されず取りこぼしていた）
  // 直近31日分を対象に、既存(物件+IN+OUT)に無いものだけINSERT（既存は消さない＝分割等を保持）。
  const floor = new Date(jstNow.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentCurrent = merged.filter((r) => { const d = upToStr(r); return d <= today && d >= floor; });

  let deleted = 0, addedLate = 0;
  await sql.begin(async (tx) => {
    if (okProps.length) {
      // 取得成功した物件の「明日以降」分だけ削除 → 入れ替え。
      const res = await tx`delete from reservations where check_in > ${today}::date and property_name in ${tx(okProps)}`;
      deleted = res.count || 0;
    }
    if (upcoming.length) {
      const payload = upcoming.map((r) => ({
        property_name: r.propertyName,
        area: r.area || "",
        platform: r.platform,
        type: r.type,
        check_in: r.checkIn.toISOString().slice(0, 10),
        check_out: r.checkOut.toISOString().slice(0, 10),
        nights: r.nights,
        res_code: r.resCode || null,
        res_url: r.resUrl || null,
        summary: r.summary || null,
      }));
      await tx`insert into reservations ${tx(payload)}`;
    }
    // 直前予約の取りこぼしを補完（既存に無いものだけ追加）
    if (recentCurrent.length && okProps.length) {
      const existing = await tx`
        select property_name, to_char(check_in,'YYYY-MM-DD') as ci, to_char(check_out,'YYYY-MM-DD') as co
        from reservations
        where check_in <= ${today}::date and check_in >= ${floor}::date and property_name in ${tx(okProps)}`;
      const seen = new Set(existing.map((x) => `${x.property_name}|${x.ci}|${x.co}`));
      const toAdd = recentCurrent.filter((r) => !seen.has(`${r.propertyName}|${r.checkIn.toISOString().slice(0,10)}|${r.checkOut.toISOString().slice(0,10)}`));
      if (toAdd.length) {
        const payload2 = toAdd.map((r) => ({
          property_name: r.propertyName, area: r.area || "", platform: r.platform, type: r.type,
          check_in: r.checkIn.toISOString().slice(0, 10), check_out: r.checkOut.toISOString().slice(0, 10),
          nights: r.nights, res_code: r.resCode || null, res_url: r.resUrl || null, summary: r.summary || null,
        }));
        await tx`insert into reservations ${tx(payload2)}`;
        addedLate = toAdd.length;
      }
    }
  });

  // 同期ログ（異常な大量削除に後から気づけるよう記録）
  try {
    await sql`insert into sync_log (ran_at, deleted, inserted, feeds_ok, feeds_error)
              values (now(), ${deleted}, ${upcoming.length + addedLate}, ${feeds.length}, ${errors.length})`;
  } catch {}

  const [{ count }] = await sql`select count(*)::int as count from reservations`;
  return { feeds: feedRows.length, reservations: count, updatedUpcoming: upcoming.length, errors };
}
