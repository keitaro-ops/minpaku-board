import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nights = (a, b) => {
  const n = Math.round((new Date(b) - new Date(a)) / DAY);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
const key = (n, ci, co) => `${n}|${ci}|${co}`;

export async function GET() {
  try {
    const sql = db();
    const [resv, ov, ci, cl, sp, rd, mm] = await Promise.all([
      sql`select property_name, area, platform, type,
                 to_char(check_in,'YYYY-MM-DD') as check_in,
                 to_char(check_out,'YYYY-MM-DD') as check_out,
                 res_code, res_url from reservations`,
      sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, type from overrides`,
      sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, submitted from checkin_status`,
      sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, status, memo from cleaning_status`,
      sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, boundaries from splits`,
      sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, ready from ready_status`,
      sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, memo from memo_status`,
    ]);

    const ovM = new Map(ov.map((x) => [key(x.property_name, x.check_in, x.check_out), x.type]));
    const ciM = new Map(ci.map((x) => [key(x.property_name, x.check_in, x.check_out), x.submitted]));
    const clM = new Map(cl.map((x) => [key(x.property_name, x.check_in, x.check_out), x]));
    const spM = new Map(sp.map((x) => [key(x.property_name, x.check_in, x.check_out), x.boundaries]));
    const rdM = new Map(rd.map((x) => [key(x.property_name, x.check_in, x.check_out), x.ready]));
    const mmM = new Map(mm.map((x) => [key(x.property_name, x.check_in, x.check_out), x.memo]));

    const out = [];
    for (const r of resv) {
      const type = ovM.get(key(r.property_name, r.check_in, r.check_out)) ?? r.type;
      // 分割の境界を厳格に検証（不正なら分割しない＝壊れない）
      let segments = [[r.check_in, r.check_out, false]];
      const bnd = spM.get(key(r.property_name, r.check_in, r.check_out));
      if (bnd) {
        const cuts = [...new Set(String(bnd).split(",").map((s) => s.trim()))]
          .filter((d) => DATE_RE.test(d) && d > r.check_in && d < r.check_out)
          .sort();
        if (cuts.length > 0) {
          const pts = [r.check_in, ...cuts, r.check_out];
          segments = [];
          for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1], true]);
        }
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
          ready: rdM.get(k) ?? false,
          memo: mmM.get(k) ?? "",
          cleaning_status: cln ? cln.status : "unrequested",
          cleaning_memo: cln ? cln.memo : "",
          split_ci: isSeg ? r.check_in : null,
          split_co: isSeg ? r.check_out : null,
        });
      }
    }
    out.sort((a, b) => a.property_name.localeCompare(b.property_name) || a.check_in.localeCompare(b.check_in));
    return NextResponse.json({ reservations: out });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e), reservations: [] }, { status: 500 });
  }
}
