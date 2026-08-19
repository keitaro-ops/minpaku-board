import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

// { from: "旧物件名", to: "新物件名" }
// feeds と、名前にひもづく全データ（reservations/overrides/checkin_status/cleaning_status/splits）を一括で改名。
// to が既存物件名なら「統合」になる（表記ゆれの解消）。
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const from = (b.from || "").trim();
  const to = (b.to || "").trim();
  if (!from || !to) return NextResponse.json({ error: "旧名・新名は必須です" }, { status: 400 });
  if (from === to) return NextResponse.json({ ok: true, unchanged: true });

  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`update feeds set property_name = ${to} where property_name = ${from}`;
      await tx`update reservations set property_name = ${to} where property_name = ${from}`;
      // 主キーが(property_name,check_in,check_out)のテーブルは衝突回避のため upsert 的に移し替え
      for (const t of ["overrides", "checkin_status", "cleaning_status", "splits"]) {
        // 既に to 側に同じ(check_in,check_out)がある行は from 側を捨てて衝突回避
        await tx.unsafe(
          `delete from ${t} a using ${t} b
             where a.property_name = $1 and b.property_name = $2
               and a.check_in = b.check_in and a.check_out = b.check_out`,
          [from, to]
        );
        await tx.unsafe(
          `update ${t} set property_name = $2 where property_name = $1`,
          [from, to]
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
