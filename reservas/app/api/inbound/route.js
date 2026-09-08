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

  if (b.kind === "airbnb_booking" && b.res_code) {
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
