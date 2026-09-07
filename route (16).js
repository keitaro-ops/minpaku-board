import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = db();
  const rows = await sql`select property_name, webhook_url from chat_webhooks`;
  return NextResponse.json({ webhooks: rows });
}

// { property_name, webhook_url }  空文字なら削除
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name) return NextResponse.json({ error: "property_name 必須" }, { status: 400 });
  const url = (b.webhook_url || "").trim();
  const sql = db();
  if (!url) {
    await sql`delete from chat_webhooks where property_name = ${b.property_name}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (!/^https:\/\/chat\.googleapis\.com\//.test(url))
    return NextResponse.json({ error: "Google Chat の Webhook URL を入力してください（https://chat.googleapis.com/ で始まる）" }, { status: 400 });
  await sql`
    insert into chat_webhooks (property_name, webhook_url) values (${b.property_name}, ${url})
    on conflict (property_name) do update set webhook_url = excluded.webhook_url`;
  return NextResponse.json({ ok: true });
}
