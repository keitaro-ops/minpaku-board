import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const sql = db();
  const rows = await sql`select id, property_name, to_char(date,'YYYY-MM-DD') as date, kind, memo from cleanings order by date`;
  return NextResponse.json({ cleanings: rows });
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !DATE_RE.test(b.date || ""))
    return NextResponse.json({ error: "物件名と日付(YYYY-MM-DD)が必要です" }, { status: 400 });
  const kind = ["inhouse", "outsourced"].includes(b.kind) ? b.kind : "inhouse";
  const sql = db();
  const [row] = await sql`
    insert into cleanings (property_name, date, kind, memo)
    values (${b.property_name}, ${b.date}, ${kind}, ${(b.memo || "").slice(0, 300)})
    returning id, property_name, to_char(date,'YYYY-MM-DD') as date, kind, memo`;
  return NextResponse.json({ cleaning: row });
}

export async function PATCH(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  const kind = ["inhouse", "outsourced"].includes(b.kind) ? b.kind : "inhouse";
  const sql = db();
  await sql`update cleanings set kind = ${kind}, memo = ${(b.memo || "").slice(0, 300)} where id = ${b.id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sql = db();
  await sql`delete from cleanings where id = ${id}`;
  return NextResponse.json({ ok: true });
}
