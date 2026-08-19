import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = db();
  const rows = await sql`select id, name, archived, sort_order from vendors order by archived, sort_order, name`;
  return NextResponse.json({ vendors: rows });
}
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.name.trim()) return NextResponse.json({ error: "業者名は必須です" }, { status: 400 });
  const sql = db();
  const [{ max }] = await sql`select coalesce(max(sort_order),0) as max from vendors`;
  const [row] = await sql`insert into vendors (name, sort_order) values (${b.name.trim()}, ${(max || 0) + 1}) returning id, name, archived, sort_order`;
  return NextResponse.json({ vendor: row });
}
export async function PATCH(req) {
  const b = await req.json().catch(() => ({}));
  const sql = db();
  // 並び順の一括保存: { order: [id, id, ...] }
  if (Array.isArray(b.order)) {
    for (let i = 0; i < b.order.length; i++) {
      await sql`update vendors set sort_order = ${i + 1} where id = ${b.order[i]}`;
    }
    return NextResponse.json({ ok: true });
  }
  if (!b.id) return NextResponse.json({ error: "id 必須" }, { status: 400 });
  if (typeof b.name === "string" && b.name.trim()) await sql`update vendors set name=${b.name.trim()} where id=${b.id}`;
  if (typeof b.archived === "boolean") await sql`update vendors set archived=${b.archived} where id=${b.id}`;
  return NextResponse.json({ ok: true });
}
