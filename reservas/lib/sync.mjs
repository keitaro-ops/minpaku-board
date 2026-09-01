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
  const today = new Date().toISOString().slice(0, 10);

  // これから始まる分（チェックイン >= 今日）だけ採用。開始済みは iCal 側を無視して保持。
  const upcoming = merged.filter((r) => r.checkIn.toISOString().slice(0, 10) >= today);

  await sql.begin(async (tx) => {
    // 未開始分のみ削除 → 入れ替え。開始済み（check_in < today）はそのまま保持。
    await tx`delete from reservations where check_in >= ${today}::date`;
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
  });

  const [{ count }] = await sql`select count(*)::int as count from reservations`;
  return { feeds: feedRows.length, reservations: count, updatedUpcoming: upcoming.length, errors };
}
