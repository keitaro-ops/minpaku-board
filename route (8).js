import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = db();
  const rows = await sql`select * from feeds order by property_name, platform`;
  return NextResponse.json({ feeds: rows });
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.platform || !b.ical_url)
    return NextResponse.json({ error: "物件名・サイト・iCal URL は必須です" }, { status: 400 });
  if (!["airbnb", "booking"].includes(b.platform))
    return NextResponse.json({ error: "platform が不正です" }, { status: 400 });
  const sql = db();
  const [row] = await sql`
    insert into feeds (property_name, area, platform, ical_url)
    values (${b.property_name}, ${b.area || ""}, ${b.platform}, ${b.ical_url})
    returning *`;
  return NextResponse.json({ feed: row });
}

export async function DELETE(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sql = db();
  await sql`delete from feeds where id = ${id}`;
  return NextResponse.json({ ok: true });
}
