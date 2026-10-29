import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apps Script から解析済みメールデータを受け取る。
// 認証: ?secret= または JSON の secret が INBOUND_SECRET と一致すること。
// body 例:
// {
//   secret, message_id, kind: "airbnb_booking"|"booking_new"|"booking_cancel",
//   res_code, adults, children, guest_name,      // Airbnb
//   res_number, check_in, property_name           // Booking
// }
export async function POST(req) {
  const url = new URL(req.url);
  const b = await req.json().catch(() => ({}));
  const secret = url.searchParams.get("secret") || b.secret;
  if (!process.env.INBOUND_SECRET || secret !== process.env.INBOUND_SECRET)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = db();
  const msgId = (b.message_id || "").slice(0, 200);

  // 重複処理防止
  if (msgId) {
    const [dup] = await sql`select message_id from inbound_log where message_id = ${msgId}`;
    if (dup) return NextResponse.json({ ok: true, duplicate: true });
  }

  let result = { ok: true };

  if (b.kind === "parking_request") {
    result = await handleParkingRequest(sql, b);
  } else if (b.kind === "parking_poll") {
    return NextResponse.json(await parkingPoll(sql));
  } else if (b.kind === "parking_ack") {
    const ids = (b.ids || []).map(Number).filter(Boolean);
    if (ids.length) await sql`update parking_notices set sent_at = now() where id in ${sql(ids)}`;
    return NextResponse.json({ ok: true, acked: ids.length });
  } else if (b.kind === "airbnb_booking" && b.res_code) {
    const adults = Number(b.adults) || 0;
    const children = Number(b.children) || 0;
    await sql`
      insert into guest_counts (res_code, adults, children, guest_name, updated_at)
      values (${b.res_code}, ${adults}, ${children}, ${(b.guest_name || "").slice(0, 120)}, now())
      on conflict (res_code) do update set adults=excluded.adults, children=excluded.children, guest_name=excluded.guest_name, updated_at=now()`;
    result.saved = "guests";
  } else if (b.kind === "airbnb_change" && b.res_code) {
    // 予約変更あり → 要確認フラグを立てる（確認コードで紐付け）
    await sql`
      insert into change_flags (res_code, guest_name, flagged_at, acknowledged)
      values (${b.res_code}, ${(b.guest_name || "").slice(0, 120)}, now(), false)
      on conflict (res_code) do update set guest_name = excluded.guest_name, flagged_at = now(), acknowledged = false`;
    result.saved = "change_flag";
  } else if (b.kind === "airbnb_cancel" && b.res_code) {
    // キャンセルは iCal 同期で予約が消える。人数・変更フラグの残骸を掃除。
    // 🚗もすぐ外す（予約がまだボードに残っている間に確認コードで特定。消えていれば同期側の掃除で外れる）
    try {
      const del = await sql`delete from parking_status p using reservations r
        where r.res_code = ${b.res_code} and r.property_name = p.property_name
          and r.check_in = p.check_in and r.check_out = p.check_out`;
      result.parking_removed = del.count || 0;
    } catch {}
    try { await sql`delete from guest_counts where res_code = ${b.res_code}`; } catch {}
    try { await sql`delete from change_flags where res_code = ${b.res_code}`; } catch {}
    result.saved = "airbnb_cancel_cleaned";
  } else if (b.kind === "booking_cancel" && b.res_number) {
    // Booking キャンセル: 予約番号に一致する予約をブロック化（集計/表示から除外）
    // res_url に予約番号が含まれることは少ないため、チェックイン日＋物件名でも補助照合。
    // ここでは記録のみ（実際の除外は将来の照合ロジックで対応）。
    result.saved = "booking_cancel_logged";
  } else if (b.kind === "booking_new") {
    result.saved = "booking_new_logged";
  }

  if (msgId) {
    await sql`insert into inbound_log (message_id, kind, info) values (${msgId}, ${(b.kind || "").slice(0,40)}, ${JSON.stringify(b).slice(0, 500)}) on conflict (message_id) do nothing`;
  }
  return NextResponse.json(result);
}

// ─────────────────────────────────────────────
// 駐車場希望（Apps Script がゲストメッセージから「駐車/車」系の言葉を検知して送ってくる）
//   parking_request: { message_id, room_id, check_in, check_out, text, thread_url }
//   parking_poll   : 問い合わせ段階で保存した希望を、予約が入っていれば反映。未送信の通知を返す
//   parking_ack    : { ids } 送信済みにする
// 駐車場を共有する建物。物件名がこの接頭辞で始まる部屋どうしで共有する。
const PARKING_BUILDINGS = { W14: 1 }; // 建物名: 駐車可能台数
const BOARD_URL = "https://minpaku-board.vercel.app/";
const buildingOf = (name) => Object.keys(PARKING_BUILDINGS).find((k) => (name || "").startsWith(k + " ") || name === k);
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 「希望」か「質問だけ」かの判定（ゲスト発言は日本語訳が付くので日本語中心＋英語）
const WANT = [
  /(駐車場|駐車スペース|パーキング)[^。？?！!\n]{0,12}(を|も)?(使|利用|予約|確保|お願い|貸)[^。？?\n]{0,8}(たい|させて|ください|下さい|お願い|希望|します|いたします)/,
  /(駐車|停め|止め)(させて|たい)/,
  /駐車[^。？?\n]{0,10}(を希望|希望します|が必要です(?!か)|が必要なので|予約したい|お願いします|お願いしたい)/,
  /(駐車場|駐車スペース|パーキング)[^。？?\n]{0,12}(確保|予約|用意|使わせ|利用させ|空けて)[^。？?\n]{0,6}(いただけ|頂け|もらえ|くださ|下さ)/,
  /(車|レンタカー|自家用車|マイカー)[^。？?\n]{0,6}(で|を運転して)(行き|来|伺い|向かい|参り|移動し|到着し)(ます|たい|予定)/,
  /レンタカーを(借り|予約し|手配し)(ます|ました|る予定|ています)/,
  /車(が|を)\s?\d?\s?台?(あります|持って|利用します)/,
  /(would like|want|need|wish) to (use|reserve|book) (the |your |a )?(parking|car ?park)/i,
  /\b(we|i)('ll| will| are going to| am going to| are| am|'re|'m)? (be )?(driving|drive|rent(ing)? a car|come by car|bring(ing)? (a|our|my) car)/i,
  /(please|kindly) (reserve|book|keep) (the |a )?parking/i,
  /\bwe (will )?need (a )?parking/i,
];
const isWant = (t) => WANT.some((re) => re.test(t || ""));

async function ensureParkingTables(sql) {
  await sql`create table if not exists parking_status (property_name text not null, check_in date not null, check_out date not null,
             parking boolean not null default false, primary key (property_name, check_in, check_out))`;
  await sql`create table if not exists parking_requests (
    id bigserial primary key, property_name text not null, check_in date not null, check_out date not null,
    text text default '', thread_url text default '', status text not null default 'pending',
    created_at timestamptz not null default now(), resolved_at timestamptz)`;
  await sql`create table if not exists parking_notices (
    id bigserial primary key, subject text not null, body text not null,
    created_at timestamptz not null default now(), sent_at timestamptz)`;
}

async function notice(sql, subject, lines) {
  const body = [...lines, "", `統合ボード: ${BOARD_URL}`].join("\n");
  await sql`insert into parking_notices (subject, body) values (${subject}, ${body})`;
}

// 同じ建物で宿泊夜が1日でも重なる🚗（現存する予約のみ。CO日=IN日は重ならない）
async function findConflicts(sql, building, property, ci, co) {
  return sql`
    select p.property_name, to_char(p.check_in,'YYYY-MM-DD') as check_in, to_char(p.check_out,'YYYY-MM-DD') as check_out
    from parking_status p
    join reservations r on r.property_name = p.property_name and r.check_in = p.check_in and r.check_out = p.check_out and r.type = 'booking'
    where p.parking = true and p.property_name like ${building + " %"}
      and p.check_in < ${co} and p.check_out > ${ci}
      and not (p.property_name = ${property} and p.check_in = ${ci} and p.check_out = ${co})`;
}
const hasReservation = async (sql, property, ci, co) =>
  !!(await sql`select 1 from reservations where property_name = ${property} and type = 'booking' and check_in = ${ci} and check_out = ${co} limit 1`)[0];
const isMarked = async (sql, property, ci, co) =>
  !!(await sql`select parking from parking_status where property_name = ${property} and check_in = ${ci} and check_out = ${co}`)[0]?.parking;

// 予約がある前提で 🚗を付ける or 被りを通知
async function markOrConflict(sql, { building, property, ci, co, text, thread_url, fromPending }) {
  const head = `${property}　${md(ci)}〜${md(co)}`;
  const tail = ["", "■ ゲストのメッセージ", text || "（なし）", "", `Airbnbのスレッド: ${thread_url || "-"}`];
  const conflicts = await findConflicts(sql, building, property, ci, co);
  if (conflicts.length >= PARKING_BUILDINGS[building]) {
    await notice(sql, `【駐車場 被り】${head}`, [
      "駐車場の希望が、すでに🚗が付いている予約と重なっています。今回の予約には🚗を付けていません。",
      "", "■ 今回の希望", head + (fromPending ? "（問い合わせ時の希望 → 予約確定）" : ""),
      "", "■ 重なっている予約", ...conflicts.map((c) => `・${c.property_name}　${md(c.check_in)}〜${md(c.check_out)}（🚗使用中）`),
      ...tail, "", "どちらに割り当てるか判断してください。"]);
    return "conflict";
  }
  await sql`insert into parking_status (property_name, check_in, check_out, parking) values (${property}, ${ci}, ${co}, true)
            on conflict (property_name, check_in, check_out) do update set parking = true`;
  await notice(sql, `【駐車場 🚗付与】${head}`, [
    `駐車場の希望を受けて、ボードの予約に🚗を付けました。${fromPending ? "（問い合わせ時の希望を、予約確定に合わせて反映）" : ""}`,
    "", "■ 予約", head, ...tail]);
  return "marked";
}

async function handleParkingRequest(sql, b) {
  const ci = b.check_in, co = b.check_out;
  if (!b.room_id || !DATE.test(ci || "") || !DATE.test(co || "")) return { ok: false, status: "bad_request" };
  await ensureParkingTables(sql);

  // 部屋ID → 物件名（Airbnb の iCal URL に部屋IDが含まれる）。リスティング名には依存しない。
  const [feed] = await sql`select property_name from feeds where platform = 'airbnb' and ical_url like ${"%" + b.room_id + "%"} limit 1`;
  const property = feed?.property_name;
  const building = buildingOf(property);
  if (!property || !building) return { ok: true, status: "not_target", property: property || null };

  const text = (b.text || "").slice(0, 1500), thread_url = (b.thread_url || "").slice(0, 300);
  const ctx = { building, property, ci, co, text, thread_url };
  if (await isMarked(sql, property, ci, co)) return { ok: true, status: "already", property };
  const reserved = await hasReservation(sql, property, ci, co);

  // 質問だけ（希望と読み取れない）→ 🚗は付けず、現在の空き状況つきで要確認通知
  if (!isWant(text)) {
    const conflicts = await findConflicts(sql, building, property, ci, co);
    await notice(sql, `【駐車場 要確認】${property}　${md(ci)}〜${md(co)}`, [
      "駐車場について質問がありました（希望とは判断できないため🚗は付けていません）。",
      "", "■ 対象", `${property}　${md(ci)}〜${md(co)}${reserved ? "" : "（ボードに予約なし＝問い合わせ段階）"}`,
      "", "■ この日程の駐車場",
      conflicts.length ? conflicts.map((c) => `・被りあり：${c.property_name}　${md(c.check_in)}〜${md(c.check_out)}（🚗使用中）`).join("\n") : "・空いています",
      "", "■ ゲストのメッセージ", text, "", `Airbnbのスレッド: ${thread_url || "-"}`]);
    return { ok: true, status: "question", property };
  }

  // 希望あり・予約確定前 → 保存しておき、予約がボードに入ったら反映（parking_poll）
  if (!reserved) {
    await sql`insert into parking_requests (property_name, check_in, check_out, text, thread_url)
              values (${property}, ${ci}, ${co}, ${text}, ${thread_url})`;
    const conflicts = await findConflicts(sql, building, property, ci, co);
    if (conflicts.length >= PARKING_BUILDINGS[building])
      await notice(sql, `【駐車場 被り（問い合わせ段階）】${property}　${md(ci)}〜${md(co)}`, [
        "問い合わせ段階の駐車場希望が、すでに🚗が付いている予約と重なっています。",
        "希望は保存してあり、予約確定時にもう一度判定します。",
        "", "■ 重なっている予約", ...conflicts.map((c) => `・${c.property_name}　${md(c.check_in)}〜${md(c.check_out)}（🚗使用中）`),
        "", "■ ゲストのメッセージ", text, "", `Airbnbのスレッド: ${thread_url || "-"}`]);
    return { ok: true, status: "pending_saved", property };
  }

  return { ok: true, status: await markOrConflict(sql, ctx), property };
}

async function parkingPoll(sql) {
  await ensureParkingTables(sql);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  await sql`update parking_requests set status = 'expired', resolved_at = now() where status = 'pending' and check_in <= ${today}`;
  const pend = await sql`select id, property_name, to_char(check_in,'YYYY-MM-DD') as ci, to_char(check_out,'YYYY-MM-DD') as co, text, thread_url
                         from parking_requests where status = 'pending' order by id`;
  const applied = [];
  const seen = new Set();
  for (const r of pend) {
    const key = `${r.property_name}|${r.ci}|${r.co}`;
    if (!(await hasReservation(sql, r.property_name, r.ci, r.co))) continue;
    let status = "already";
    if (!seen.has(key) && !(await isMarked(sql, r.property_name, r.ci, r.co)))
      status = await markOrConflict(sql, { building: buildingOf(r.property_name), property: r.property_name, ci: r.ci, co: r.co,
                                           text: r.text, thread_url: r.thread_url, fromPending: true });
    seen.add(key);
    await sql`update parking_requests set status = ${status}, resolved_at = now() where id = ${r.id}`;
    applied.push({ id: r.id, status });
  }
  const notices = await sql`select id, subject, body from parking_notices where sent_at is null order by id limit 50`;
  return { ok: true, applied, notices };
}
