import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const sql = db();
  if (!b.property_name || !DATE_RE.test(b.check_in || "") || !DATE_RE.test(b.check_out || ""))
    return NextResponse.json({ error: "日付の形式が不正です（YYYY-MM-DD）" }, { status: 400 });
  if (!b.boundaries || b.boundaries.length === 0) {
    await sql`delete from splits where property_name=${b.property_name} and check_in=${b.check_in} and check_out=${b.check_out}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  const uniq = [...new Set(b.boundaries.map((d) => String(d).trim()))]
    .filter((d) => DATE_RE.test(d) && d > b.check_in && d < b.check_out)
    .sort();
  if (uniq.length === 0)
    return NextResponse.json({ error: "分割日は YYYY-MM-DD 形式で、開始日と終了日の間にしてください" }, { status: 400 });
  await sql`
    insert into splits (property_name, check_in, check_out, boundaries)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${uniq.join(",")})
    on conflict (property_name, check_in, check_out) do update set boundaries = excluded.boundaries`;
  return NextResponse.json({ ok: true, boundaries: uniq });
}
