import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// data 形: { tags:[{id,name,color}], propTags:{ "物件名":[tagId,...] }, order:["物件名",...], groupByTag:bool }
export async function GET() {
  const sql = db();
  const [row] = await sql`select data from board_settings where id = 1`;
  return NextResponse.json({ settings: row?.data || {} });
}

export async function PUT(req) {
  const b = await req.json().catch(() => ({}));
  const data = b && typeof b === "object" ? b : {};
  const sql = db();
  await sql`
    insert into board_settings (id, data, updated_at) values (1, ${sql.json(data)}, now())
    on conflict (id) do update set data = excluded.data, updated_at = now()`;
  return NextResponse.json({ ok: true });
}
