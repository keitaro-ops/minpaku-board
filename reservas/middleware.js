import { NextResponse } from "next/server";

async function tokenFor(role) {
  const data = new TextEncoder().encode(`${role}::${process.env.APP_SECRET || ""}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const OPEN = ["/login", "/api/login", "/api/cron"];
// 非GETで admin のみ許可するパス
const ADMIN_ONLY = ["/api/settings", "/api/feeds", "/api/rename", "/api/webhooks"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  const token = req.cookies.get("rb_auth")?.value;
  let role = null;
  if (token) {
    for (const r of ["admin", "staff", "viewer"]) {
      if (token === (await tokenFor(r))) { role = r; break; }
    }
  }
  if (!role) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone(); url.pathname = "/login"; return NextResponse.redirect(url);
  }

  // 権限チェック（書き込み系）
  if (method !== "GET") {
    if (role === "viewer") return NextResponse.json({ error: "権限がありません（閲覧のみ）" }, { status: 403 });
    if (ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/")) && role !== "admin")
      return NextResponse.json({ error: "権限がありません（管理者のみ）" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
