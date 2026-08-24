import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/billing?month=YYYY-MM[&approved=1]
export async function GET(req) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const approvedOnly = url.searchParams.get("approved") === "1";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM" }, { status: 400 });
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

  const sql = db();
  // 明細（1件ごと）を取得。日付順。
  const rows = await sql`
    select c.property_name, c.vendor_id, coalesce(v.name,'（業者未選択）') as vendor_name,
           to_char(c.date,'YYYY-MM-DD') as date, r.price as price
    from cleanings c
    left join vendors v on v.id = c.vendor_id
    left join vendor_rates r on r.vendor_id = c.vendor_id and r.property_name = c.property_name
    where c.date >= ${start} and c.date < ${end}
      ${approvedOnly ? sql`and c.status = 'approved'` : sql``}
    order by vendor_name, c.property_name, c.date`;

  // 業者別 → 物件別に集約。物件明細に日付リストを持たせる。
  const byVendor = {};
  let grandTotal = 0, grandCount = 0, hasUnset = false;
  for (const x of rows) {
    const vkey = x.vendor_id || "none";
    (byVendor[vkey] ||= { vendor_id: x.vendor_id, vendor_name: x.vendor_name, props: {}, subtotal: 0, count: 0, unset: false });
    const vb = byVendor[vkey];
    (vb.props[x.property_name] ||= { property_name: x.property_name, dates: [], price: x.price != null ? Number(x.price) : null });
    vb.props[x.property_name].dates.push(x.date);
    vb.count++; grandCount++;
    if (x.price != null) { vb.subtotal += Number(x.price); grandTotal += Number(x.price); }
    else { vb.unset = true; hasUnset = true; }
  }
  const vendors = Object.values(byVendor).map((vb) => ({
    vendor_id: vb.vendor_id, vendor_name: vb.vendor_name, count: vb.count, subtotal: vb.subtotal, unset: vb.unset,
    items: Object.values(vb.props).map((p) => ({
      property_name: p.property_name, count: p.dates.length, dates: p.dates,
      price: p.price, amount: p.price != null ? p.price * p.dates.length : null,
    })).sort((a, b) => a.property_name.localeCompare(b.property_name)),
  })).sort((a, b) => (a.vendor_name || "").localeCompare(b.vendor_name || ""));

  return NextResponse.json({ month, approvedOnly, vendors, grandTotal, grandCount, hasUnset });
}
