import { db } from "./db.mjs";
import { parseICS, mergeFeeds } from "./ical.mjs";

// 全フィードを取得→解析→統合→reservations を入れ替える
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

  await sql.begin(async (tx) => {
    await tx`delete from reservations`;
    if (merged.length) {
      const payload = merged.map((r) => ({
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

  return { feeds: feedRows.length, reservations: merged.length, errors };
}
