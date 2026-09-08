import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// 予約単位の人数を手動保存（物件名+IN+OUT）。管理者・運用者のみ（middleware）。
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.check_in || !b.check_out)
    return NextResponse.json({ error: "必須項目が不足" }, { status: 400 });
  const adults = Math.max(0, parseInt(b.adults, 10) || 0);
  const children = Math.max(0, parseInt(b.children, 10) || 0);
  const sql = db();
  if (adults === 0 && children === 0) {
    await sql`delete from guest_manual where property_name=${b.property_name} and check_in=${b.check_in} and check_out=${b.check_out}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  await sql`
    insert into guest_manual (property_name, check_in, check_out, adults, children)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${adults}, ${children})
    on conflict (property_name, check_in, check_out) do update set adults=excluded.adults, children=excluded.children`;
  return NextResponse.json({ ok: true });
}
