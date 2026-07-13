import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const sql = db();
  const rows = await sql`
    select r.property_name, r.area, r.platform,
           coalesce(o.type, r.type) as type,
           r.check_in, r.check_out, r.nights, r.res_code, r.res_url,
           coalesce(c.submitted, false) as info_submitted
    from reservations r
    left join overrides o
      on o.property_name = r.property_name and o.check_in = r.check_in and o.check_out = r.check_out
    left join checkin_status c
      on c.property_name = r.property_name and c.check_in = r.check_in and c.check_out = r.check_out
    order by r.property_name, r.check_in`;
  return NextResponse.json({ reservations: rows });
}
