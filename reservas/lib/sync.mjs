import { db } from "./db.mjs";
import { parseICS, mergeFeeds } from "./ical.mjs";

// 案X: 過去分（チェックアウト < 今日）はDBに確定保存して残す。
// 未来分（チェックアウト >= 今日）だけ iCal 最新で入れ替える。
// これにより、過ぎた予約は iCal から消えても実績として積み上がる。
// Booking の手動分割(splits)は読み取り時に適用され、過去の生ブロックは
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

  // 未来分（チェックアウト >= 今日）だけ採用。過去分は iCal 側を無視。
  const future = merged.filter((r) => r.checkOut.toISOString().slice(0, 10) >= today);

  await sql.begin(async (tx) => {
    // 未来分のみ削除 → 入れ替え。過去分（check_out < today）はそのまま保持。
    await tx`delete from reservations where check_out >= ${today}::date`;
    if (future.length) {
      const payload = future.map((r) => ({
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

  // 参考: 現在の総件数（過去＋未来）
  const [{ count }] = await sql`select count(*)::int as count from reservations`;
  return { feeds: feedRows.length, reservations: count, updatedFuture: future.length, errors };
}
