import { NextResponse } from "next/server";
import { runSync } from "../../../lib/sync.mjs";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST() {
  try { return NextResponse.json(await runSync()); }
  catch (e) { return NextResponse.json({ error: String(e.message || e) }, { status: 500 }); }
}
