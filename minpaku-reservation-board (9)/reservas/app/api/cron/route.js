import { NextResponse } from "next/server";
import { runSync } from "../../../lib/sync.mjs";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try { return NextResponse.json(await runSync()); }
  catch (e) { return NextResponse.json({ error: String(e.message || e) }, { status: 500 }); }
}
