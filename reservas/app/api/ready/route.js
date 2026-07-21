import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.check_in || !b.check_out)
    return NextResponse.json({ error: "必須項目が不足" }, { status: 400 });
  const sql = db();
  await sql`
    insert into ready_status (property_name, check_in, check_out, ready)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${!!b.ready})
    on conflict (property_name, check_in, check_out) do update set ready = excluded.ready`;
  return NextResponse.json({ ok: true });
}
