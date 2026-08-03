import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = db();
  const rows = await sql`select id, name, archived from vendors order by archived, name`;
  return NextResponse.json({ vendors: rows });
}
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.name.trim()) return NextResponse.json({ error: "業者名は必須です" }, { status: 400 });
  const sql = db();
  const [row] = await sql`insert into vendors (name) values (${b.name.trim()}) returning id, name, archived`;
  return NextResponse.json({ vendor: row });
}
export async function PATCH(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id 必須" }, { status: 400 });
  const sql = db();
  if (typeof b.name === "string" && b.name.trim()) await sql`update vendors set name=${b.name.trim()} where id=${b.id}`;
  if (typeof b.archived === "boolean") await sql`update vendors set archived=${b.archived} where id=${b.id}`;
  return NextResponse.json({ ok: true });
}
