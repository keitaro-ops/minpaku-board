import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86400000;
const nights = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / DAY));
const key = (n, ci, co) => `${n}|${ci}|${co}`;

export async function GET() {
  const sql = db();
  const [resv, ov, ci, cl, sp] = await Promise.all([
    sql`select property_name, area, platform, type,
               to_char(check_in,'YYYY-MM-DD') as check_in,
               to_char(check_out,'YYYY-MM-DD') as check_out,
               res_code, res_url from reservations`,
    sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, type from overrides`,
    sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, submitted from checkin_status`,
    sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, status, memo from cleaning_status`,
    sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, boundaries from splits`,
  ]);

  const ovM = new Map(ov.map((x) => [key(x.property_name, x.check_in, x.check_out), x.type]));
  const ciM = new Map(ci.map((x) => [key(x.property_name, x.check_in, x.check_out), x.submitted]));
  const clM = new Map(cl.map((x) => [key(x.property_name, x.check_in, x.check_out), x]));
  const spM = new Map(sp.map((x) => [key(x.property_name, x.check_in, x.check_out), x.boundaries]));

  const out = [];
  for (const r of resv) {
    const type = ovM.get(key(r.property_name, r.check_in, r.check_out)) ?? r.type;
    const bnd = spM.get(key(r.property_name, r.check_in, r.check_out));
    // 分割の境界からセグメント（宿泊）を作る
    let segments;
    if (bnd) {
      const pts = [r.check_in, ...bnd.split(",").filter(Boolean), r.check_out];
      segments = [];
      for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1], true]);
    } else {
      segments = [[r.check_in, r.check_out, false]];
    }
    for (const [sci, sco, isSeg] of segments) {
      const k = key(r.property_name, sci, sco);
      const cln = clM.get(k);
      out.push({
        property_name: r.property_name, area: r.area, platform: r.platform,
        type: isSeg ? "booking" : type,
        check_in: sci, check_out: sco, nights: nights(sci, sco),
        res_code: isSeg ? null : r.res_code, res_url: r.res_url,
        info_submitted: ciM.get(k) ?? false,
        cleaning_status: cln ? cln.status : "unrequested",
        cleaning_memo: cln ? cln.memo : "",
        split_ci: isSeg ? r.check_in : null,
        split_co: isSeg ? r.check_out : null,
      });
    }
  }
  out.sort((a, b) => a.property_name.localeCompare(b.property_name) || a.check_in.localeCompare(b.check_in));
  return NextResponse.json({ reservations: out });
}
