import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.check_in || !b.check_out)
    return NextResponse.json({ error: "必須項目が不足" }, { status: 400 });
  const sql = db();
  const memo = (b.memo || "").slice(0, 500);
  if (!memo) {
    await sql`delete from memo_status where property_name=${b.property_name} and check_in=${b.check_in} and check_out=${b.check_out}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  await sql`
    insert into memo_status (property_name, check_in, check_out, memo)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${memo})
    on conflict (property_name, check_in, check_out) do update set memo = excluded.memo`;
  return NextResponse.json({ ok: true });
}
