import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("rb_auth", "", { path: "/", maxAge: 0 });
  return res;
}
