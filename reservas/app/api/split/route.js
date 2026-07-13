import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// { property_name, check_in, check_out, boundaries: ["YYYY-MM-DD", ...] | null }
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const sql = db();
  if (!b.boundaries || b.boundaries.length === 0) {
    await sql`delete from splits where property_name=${b.property_name} and check_in=${b.check_in} and check_out=${b.check_out}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  // 妥当性: check_in < 各境界 < check_out、昇順・重複排除
  const uniq = [...new Set(b.boundaries)].filter((d) => d > b.check_in && d < b.check_out).sort();
  if (uniq.length === 0) return NextResponse.json({ error: "分割日は開始日と終了日の間の日付にしてください" }, { status: 400 });
  await sql`
    insert into splits (property_name, check_in, check_out, boundaries)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${uniq.join(",")})
    on conflict (property_name, check_in, check_out) do update set boundaries = excluded.boundaries`;
  return NextResponse.json({ ok: true, boundaries: uniq });
}
