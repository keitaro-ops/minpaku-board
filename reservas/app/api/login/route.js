import { NextResponse } from "next/server";
import { roleToken, roleForPassword } from "../../../lib/db.mjs";
export const runtime = "nodejs";

export async function POST(req) {
  const { password } = await req.json().catch(() => ({}));
  const role = roleForPassword(password);
  if (!role) return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  const res = NextResponse.json({ ok: true, role });
  const opts = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 };
  res.cookies.set("rb_auth", await roleToken(role), opts);
  res.cookies.set("rb_role", role, { ...opts, httpOnly: false }); // 画面表示用（改ざんされてもトークンで検証）
  return res;
}
