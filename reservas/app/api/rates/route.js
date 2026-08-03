import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = db();
  const rows = await sql`select property_name, vendor_id, price from vendor_rates`;
  return NextResponse.json({ rates: rows });
}
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.vendor_id) return NextResponse.json({ error: "必須項目不足" }, { status: 400 });
  const sql = db();
  const price = parseInt(b.price, 10);
  if (!Number.isFinite(price) || price <= 0) {
    await sql`delete from vendor_rates where property_name=${b.property_name} and vendor_id=${b.vendor_id}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  await sql`
    insert into vendor_rates (property_name, vendor_id, price) values (${b.property_name}, ${b.vendor_id}, ${price})
    on conflict (property_name, vendor_id) do update set price = excluded.price`;
  return NextResponse.json({ ok: true });
}
