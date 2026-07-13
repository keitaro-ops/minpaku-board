// 依存ゼロの iCal(.ics) パーサ + 予約/ブロック判定
// RFC5545 の VEVENT を最低限だけ解釈する。

function unfold(text) {
  // 折り返し行（CRLF + 空白/タブ）を連結
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseICalDate(val) {
  // "20261001" (DATE) または "20261001T150000Z" (DATE-TIME)
  const m = val.match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  // 日付として UTC 正午で保持（TZ ずれで前後の日にまたがらないように）
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
}

function dayDiff(a, b) {
  return Math.round((a - b) / 86400000);
}

// 1つの VEVENT テキスト → イベントオブジェクト
function parseEvent(block) {
  const fields = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx); // 例: DTSTART;VALUE=DATE
    const key = rawKey.split(";")[0].toUpperCase();
    const value = line.slice(idx + 1).trim();
    // DESCRIPTION 等は複数行/エスケープあり
    fields[key] = (fields[key] ? fields[key] + "\n" : "") + value;
  }
  const start = fields.DTSTART ? parseICalDate(fields.DTSTART) : null;
  const end = fields.DTEND ? parseICalDate(fields.DTEND) : null;
  if (!start || !end) return null;

  const summary = (fields.SUMMARY || "").replace(/\\,/g, ",").replace(/\\n/g, " ").trim();
  const description = (fields.DESCRIPTION || "").replace(/\\n/g, "\n").replace(/\\,/g, ",");
  const uid = fields.UID || `${fields.DTSTART}-${fields.DTEND}-${summary}`;

  // Airbnb の予約詳細 URL
  const urlMatch = description.match(/https?:\/\/[^\s]*airbnb\.[^\s]*reservations?\/[^\s]*/i)
    || description.match(/https?:\/\/[^\s]*airbnb\.[^\s]*\/hosting\/reservations\/[^\s]*/i);
  const resUrl = urlMatch ? urlMatch[0].replace(/[).,]+$/, "") : null;

  // 予約コード（Airbnb HMxxxx / URL 末尾 / Booking の番号）
  let resCode = null;
  const hm = description.match(/\b(HM[A-Z0-9]{6,})\b/);
  if (hm) resCode = hm[1];
  else if (resUrl) resCode = resUrl.split("/").filter(Boolean).pop();

  // ブロック判定：予約実体が無く「利用不可」系の要約
  const blockLike = /(not\s*available|unavailable|blocked|closed\s*-\s*not\s*available|reserved\s*-\s*airbnb\s*\(not\s*available\))/i.test(summary);
  const hasIdentity = !!resUrl || /reserved/i.test(summary) || (resCode && !blockLike);
  const type = hasIdentity ? "booking" : blockLike ? "block" : "booking";

  const nights = Math.max(1, dayDiff(end, start));
  return { uid, summary, checkIn: start, checkOut: end, nights, resUrl, resCode, type };
}

export function parseICS(text) {
  const t = unfold(text);
  const blocks = t.split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]);
  const out = [];
  for (const b of blocks) {
    const ev = parseEvent(b);
    if (ev) out.push(ev);
  }
  return out;
}

const rangeKey = (prop, ev) => `${prop}|${ev.checkIn.getTime()}|${ev.checkOut.getTime()}`;

// 複数フィード（物件×サイト）を統合し、双方向連携由来の重複を排除する。
// feeds: [{ propertyName, area, platform:'airbnb'|'booking', events:[...] }]
// 方針:
//  1) Airbnb の "Reserved"(URLあり) は確実な Airbnb 予約 → 採用
//  2) Booking フィードの枠は、Airbnb予約と日程一致すれば取込み反映なので破棄、
//     それ以外は Booking 予約として採用（CLOSED でも既定は予約扱い）
//  3) Airbnb の "Not available" は、既出の枠と一致すれば反映なので破棄、
//     どこにも一致しなければ手動ブロックとして採用
export function mergeFeeds(feeds) {
  const airbnb = feeds.filter((f) => f.platform === "airbnb");
  const booking = feeds.filter((f) => f.platform === "booking");
  const rows = new Map();

  // 1) Airbnb 実予約
  for (const f of airbnb) {
    for (const ev of f.events) {
      if (ev.type !== "booking") continue;
      rows.set(rangeKey(f.propertyName, ev), {
        propertyName: f.propertyName, area: f.area, platform: "airbnb",
        ...ev, type: "booking",
      });
    }
  }
  // 2) Booking 枠
  for (const f of booking) {
    for (const ev of f.events) {
      const k = rangeKey(f.propertyName, ev);
      const existing = rows.get(k);
      if (existing && existing.platform === "airbnb") continue; // Airbnb予約の取込み反映
      rows.set(k, {
        propertyName: f.propertyName, area: f.area, platform: "booking",
        ...ev, type: "booking",
      });
    }
  }
  // 3) Airbnb のブロック（手動ブロック等）
  for (const f of airbnb) {
    for (const ev of f.events) {
      if (ev.type !== "block") continue;
      const k = rangeKey(f.propertyName, ev);
      if (rows.has(k)) continue; // 既に予約として採用済み → 反映なので無視
      rows.set(k, {
        propertyName: f.propertyName, area: f.area, platform: "airbnb",
        ...ev, type: "block",
      });
    }
  }

  const out = [...rows.values()];
  out.sort((a, b) => a.checkIn - b.checkIn || a.propertyName.localeCompare(b.propertyName));
  return out;
}
