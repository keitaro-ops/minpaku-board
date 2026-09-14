import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = db();
  const rows = await sql`select property_name, note, address, biller_id from property_notes`;
  return NextResponse.json({ notes: rows });
}

// { property_name, note, address, biller_id }  全部空なら行削除
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name) return NextResponse.json({ error: "property_name 必須" }, { status: 400 });
  const sql = db();
  const note = (b.note || "").slice(0, 1000);
  const address = (b.address || "").slice(0, 300);
  const billerId = b.biller_id ? Number(b.biller_id) : null;
  if (!note && !address && !billerId) {
    await sql`delete from property_notes where property_name = ${b.property_name}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  await sql`
    insert into property_notes (property_name, note, address, biller_id) values (${b.property_name}, ${note}, ${address}, ${billerId})
    on conflict (property_name) do update set note = excluded.note, address = excluded.address, biller_id = excluded.biller_id`;
  return NextResponse.json({ ok: true });
}
