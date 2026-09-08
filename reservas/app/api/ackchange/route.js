import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// 変更フラグを「確認済み」にする（=表示から消す）。管理者・運用者のみ（middlewareで制御）。
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.res_code) return NextResponse.json({ error: "res_code 必須" }, { status: 400 });
  const sql = db();
  await sql`update change_flags set acknowledged = true where res_code = ${b.res_code}`;
  return NextResponse.json({ ok: true });
}
