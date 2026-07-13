import { NextResponse } from "next/server";

async function expectedToken() {
  const data = new TextEncoder().encode(`${process.env.DASHBOARD_PASSWORD}::${process.env.APP_SECRET || ""}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 認証不要のパス
const OPEN = ["/login", "/api/login", "/api/cron"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const token = req.cookies.get("rb_auth")?.value;
  const ok = token && token === (await expectedToken());
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
