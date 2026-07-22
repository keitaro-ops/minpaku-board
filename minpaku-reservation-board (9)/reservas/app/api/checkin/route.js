import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// { property_name, check_in, check_out, submitted: boolean }
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.submitted !== "boolean")
    return NextResponse.json({ error: "submitted(boolean) が必要です" }, { status: 400 });
  const sql = db();
  await sql`
    insert into checkin_status (property_name, check_in, check_out, submitted)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${b.submitted})
    on conflict (property_name, check_in, check_out) do update set submitted = excluded.submitted`;
  return NextResponse.json({ ok: true });
}
