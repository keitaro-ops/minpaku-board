// ダブルブッキング検知の共有ロジック（iCal検知とメール照合の両方で使う）
const fmtMD = (s) => { const [, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}`; };
const platName = (x) => (x === "airbnb" ? "Airbnb" : x === "booking" ? "Booking.com" : x || "?");

export async function ensureConflictTable(sql) {
  await sql`
    create table if not exists booking_conflicts (
      conflict_key text primary key,
      property_name text not null,
      detail text not null default '',
      detected_at timestamptz not null default now(),
      notified_chat boolean not null default false,
      resolved boolean not null default false,
      resolved_at timestamptz
    )`;
}

// 行idに依存しない正規キー（2辺を文字列ソート）。iCal検知とメール照合で同一キーになり重複通知を防ぐ。
export function conflictKey(property, A, B) {
  const sa = `${A.platform}:${A.ci}:${A.co}`, sb = `${B.platform}:${B.ci}:${B.co}`;
  const [x, y] = [sa, sb].sort();
  return `${property}||${x}||${y}`;
}

export async function alertConflictChat(sql, property_name, A, B, overlap, note) {
  const text =
    `⚠️ 【ダブルブッキングの可能性】${property_name}\n` +
    `A: ${platName(A.platform)}  ${fmtMD(A.ci)}〜${fmtMD(A.co)}\n` +
    `B: ${platName(B.platform)}  ${fmtMD(B.ci)}〜${fmtMD(B.co)}\n` +
    `重なり: ${fmtMD(overlap.ci)}〜${fmtMD(overlap.co)}\n` +
    (note ? note + "\n" : "") +
    `※ Airbnb と Booking の連動・在庫設定をご確認ください。`;
  const urls = [];
  try {
    const [hook] = await sql`select webhook_url from chat_webhooks where property_name = ${property_name}`;
    if (hook?.webhook_url) urls.push(hook.webhook_url);
  } catch {}
  if (process.env.OPS_CHAT_WEBHOOK) urls.push(process.env.OPS_CHAT_WEBHOOK);
  for (const u of urls) {
    try {
      await fetch(u, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ text }) });
    } catch {}
  }
}

// 通知可能な時間帯か（JST 9:00–20:00）。20:00以降・翌9:00前は保留し、9時以降の実行で送る。
export function isNotifyHourJST(d = new Date()) {
  const h = (d.getUTCHours() + 9) % 24;   // UTC→JST
  return h >= 9 && h < 20;
}

// 1件の衝突を記録（ここでは通知しない。送信は flushPendingAlerts が時間帯を見て行う）。
// 再出現（以前 resolved）時は notified_chat を false に戻し、再通知の対象にする。
export async function recordConflict(sql, { property_name, A, B, overlap, note }) {
  const key = conflictKey(property_name, A, B);
  const [row] = await sql`select resolved from booking_conflicts where conflict_key = ${key}`;
  const isNew = !row || row.resolved === true;
  const detail = JSON.stringify({ a: A, b: B, overlap, note: note || "" });
  await sql`
    insert into booking_conflicts (conflict_key, property_name, detail, detected_at, notified_chat, resolved, resolved_at)
    values (${key}, ${property_name}, ${detail}, now(), false, false, null)
    on conflict (conflict_key) do update set
      resolved = false, resolved_at = null, detail = excluded.detail,
      notified_chat = case when booking_conflicts.resolved then false else booking_conflicts.notified_chat end`;
  return { key, isNew };
}

// 未通知(notified_chat=false)かつ未解決の衝突を、通知可能時間帯にまとめて送る。
// currentKeys（今回の実行で現に検知されたキー集合）に含まれるものだけ送るので、
// 夜間に出て自己解決した衝突は送られない。戻り値は送信件数。
export async function flushPendingAlerts(sql, currentKeys) {
  if (!isNotifyHourJST()) return 0;
  let pend = [];
  try {
    pend = await sql`select conflict_key, property_name, detail from booking_conflicts where resolved = false and notified_chat = false`;
  } catch { return 0; }
  let sent = 0;
  for (const row of pend) {
    if (currentKeys && !currentKeys.has(row.conflict_key)) continue;
    let d = {};
    try { d = JSON.parse(row.detail || "{}"); } catch {}
    if (!d.a || !d.b || !d.overlap) continue;
    await alertConflictChat(sql, row.property_name, d.a, d.b, d.overlap, d.note || "");
    await sql`update booking_conflicts set notified_chat = true, detected_at = now() where conflict_key = ${row.conflict_key}`;
    sent++;
  }
  return sent;
}

// Bookingの予約メール（email_bookings）を使って、完全同一日程を含む二重予約を割り出す。
// iCalの CLOSED は予約/ブロック区別不能だが、メール＝本物の予約の確証。
// → メールで確定した Booking 予約の日程を iCal の該当予約から特定し、同じ物件の Airbnb 予約と重なれば衝突。
export async function detectEmailConflicts(sql, today) {
  let ebs = [];
  try {
    ebs = await sql`select res_id, hotel_id, property_name, to_char(check_in,'YYYY-MM-DD') as ci
                    from email_bookings where active = true and check_in >= ${today}::date - 35`;
  } catch { return []; }   // テーブル未作成 = まだメール連携なし
  const out = [];
  for (const eb of ebs) {
    const property = await resolveBookingProperty(sql, eb);
    if (!property) continue;   // 物件を一意に特定できない時は誤検知回避でスキップ

    // Booking 滞在の check_out を特定。
    //  - 通常/部分重なり: Booking予約行が iCal に残っているのでそれを使う
    //  - 完全同一日程: Booking予約は mergeで畳まれ残らない → 同じ check_in の予約行(＝相手のAirbnb)の co を使う
    let co = null;
    const [bk] = await sql`select to_char(check_out,'YYYY-MM-DD') as co from reservations
                           where property_name = ${property} and platform = 'booking' and type = 'booking' and check_in = ${eb.ci}::date
                           order by check_out desc limit 1`;
    if (bk) co = bk.co;
    if (!co) {
      const [any] = await sql`select to_char(check_out,'YYYY-MM-DD') as co from reservations
                              where property_name = ${property} and type = 'booking' and check_in = ${eb.ci}::date
                              order by check_out desc limit 1`;
      if (any) co = any.co;
    }
    if (!co || co <= today) continue;   // 日程不明/過去はスキップ

    // 同じ物件の Airbnb 予約で夜が重なるもの（CO=IN は重ならない）
    const airs = await sql`select to_char(check_in,'YYYY-MM-DD') as ci, to_char(check_out,'YYYY-MM-DD') as co from reservations
                           where property_name = ${property} and platform = 'airbnb' and type = 'booking'
                             and check_in < ${co}::date and check_out > ${eb.ci}::date`;
    for (const a of airs) {
      out.push({
        property_name: property,
        A: { platform: "airbnb", ci: a.ci, co: a.co },
        B: { platform: "booking", ci: eb.ci, co },
        overlap: { ci: a.ci > eb.ci ? a.ci : eb.ci, co: a.co < co ? a.co : co },
        note: "（Bookingの予約メールで確定／完全同一日程も検知）",
      });
    }
  }
  return out;
}

// hotel_id→feeds で物件候補を出し、1つに特定できる時だけ物件名を返す（多部屋ホテルの誤検知を防ぐ）。
async function resolveBookingProperty(sql, eb) {
  let cands = [];
  if (eb.hotel_id) {
    const r = await sql`select distinct property_name from feeds where platform = 'booking' and ical_url like ${"%" + eb.hotel_id + "%"}`;
    cands = r.map((x) => x.property_name);
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    // 複数部屋が同じ hotel_id → その check_in に Booking 予約行がある部屋で絞る
    const narrow = await sql`select distinct property_name from reservations
                             where platform = 'booking' and type = 'booking' and check_in = ${eb.ci}::date and property_name in ${sql(cands)}`;
    if (narrow.length === 1) return narrow[0].property_name;
    if (eb.property_name && cands.includes(eb.property_name)) return eb.property_name;
    return null;   // 特定不能 → スキップ
  }
  // hotel_id で引けない（feedsにhotel_idが無い等）→ ヒント物件名、最後に check_in 単独一致で1件のみ
  if (eb.property_name) {
    const [hit] = await sql`select 1 as e from feeds where property_name = ${eb.property_name} limit 1`;
    if (hit) return eb.property_name;
  }
  const single = await sql`select distinct property_name from reservations where type = 'booking' and check_in = ${eb.ci}::date`;
  return single.length === 1 ? single[0].property_name : null;
}
