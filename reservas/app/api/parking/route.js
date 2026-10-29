import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
import { ensureParkingTables } from "../../../lib/parking.mjs";
export const runtime = "nodejs";

// 駐車場マーク（予約単位）のオン/オフ。同期で消えない上書きテーブルに保存。
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.check_in || !b.check_out)
    return NextResponse.json({ error: "必須項目が不足" }, { status: 400 });
  const sql = db();
  // ゲスト連絡の手動設定（電話や短い返事など、メッセージから判別できない場合）
  //   contact: "want"(必要) | "no_car"(不要) | "clear"(手動設定を解除)
  if (b.contact) {
    await ensureParkingTables(sql);
    const mid = `manual:${b.property_name}|${b.check_in}|${b.check_out}`;
    if (b.contact === "clear") {
      await sql`delete from parking_messages where message_id = ${mid}`.catch(() => {});
    } else if (b.contact === "want" || b.contact === "no_car") {
      await sql`insert into parking_messages (message_id, property_name, check_in, check_out, intent, text, sent_at)
                values (${mid}, ${b.property_name}, ${b.check_in}, ${b.check_out}, ${b.contact}, '（ボードで手動設定）', now())
                on conflict (message_id) do update set intent = excluded.intent, sent_at = now()`;
    } else return NextResponse.json({ error: "contact が不正" }, { status: 400 });
    await sql`delete from parking_alerts where property_name = ${b.property_name} and check_in = ${b.check_in} and check_out = ${b.check_out}`.catch(() => {});
    return NextResponse.json({ ok: true });
  }
  // 保存先テーブルを自動作成（無ければ）。初回のトグルで自動セットアップされる。
  await sql`
    create table if not exists parking_status (
      property_name text not null,
      check_in  date not null,
      check_out date not null,
      parking   boolean not null default false,
      primary key (property_name, check_in, check_out)
    )`;
  // ボードからの操作は「手動」として記録（自動付与との区別。食い違い検知に使う）
  await ensureParkingTables(sql);
  await sql`
    insert into parking_status (property_name, check_in, check_out, parking, source)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${!!b.parking}, 'manual')
    on conflict (property_name, check_in, check_out) do update set parking = excluded.parking, source = 'manual'`;
  // 付け外ししたら、その予約の食い違い通知履歴をリセット（新しい状態で改めて判定）
  await sql`delete from parking_alerts where property_name = ${b.property_name} and check_in = ${b.check_in} and check_out = ${b.check_out}`.catch(() => {});
  return NextResponse.json({ ok: true });
}
