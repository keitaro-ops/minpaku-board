import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// { property_name, check_in, check_out, status?, memo? }
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const status = b.status ?? "unrequested";
  if (!["unrequested", "requested", "inhouse"].includes(status))
    return NextResponse.json({ error: "status が不正です" }, { status: 400 });
  const memo = (b.memo ?? "").slice(0, 500);
  const sql = db();
  await sql`
    insert into cleaning_status (property_name, check_in, check_out, status, memo)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${status}, ${memo})
    on conflict (property_name, check_in, check_out)
    do update set status = excluded.status, memo = excluded.memo`;
  return NextResponse.json({ ok: true });
}
