import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const sql = db();
  if (b.type === null) {
    await sql`delete from overrides
      where property_name=${b.property_name} and check_in=${b.check_in} and check_out=${b.check_out}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (!["booking", "block"].includes(b.type))
    return NextResponse.json({ error: "type が不正です" }, { status: 400 });
  await sql`
    insert into overrides (property_name, check_in, check_out, type)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${b.type})
    on conflict (property_name, check_in, check_out) do update set type = excluded.type`;
  return NextResponse.json({ ok: true });
}
