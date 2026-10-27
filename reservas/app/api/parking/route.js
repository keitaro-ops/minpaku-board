import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// 駐車場マーク（予約単位）のオン/オフ。同期で消えない上書きテーブルに保存。
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.check_in || !b.check_out)
    return NextResponse.json({ error: "必須項目が不足" }, { status: 400 });
  const sql = db();
  await sql`
    insert into parking_status (property_name, check_in, check_out, parking)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${!!b.parking})
    on conflict (property_name, check_in, check_out) do update set parking = excluded.parking`;
  return NextResponse.json({ ok: true });
}
