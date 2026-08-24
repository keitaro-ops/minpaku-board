import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/billing?month=YYYY-MM[&approved=1]
// 指定月の清掃を業者別×物件別に集計。単価は vendor_rates（物件×業者）から。
export async function GET(req) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const approvedOnly = url.searchParams.get("approved") === "1";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM" }, { status: 400 });
  const start = `${month}-01`;
  // 翌月1日
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

  const sql = db();
  const rows = await sql`
    select c.property_name, c.vendor_id, coalesce(v.name,'（業者未選択）') as vendor_name,
           count(*)::int as cnt, r.price as price
    from cleanings c
    left join vendors v on v.id = c.vendor_id
    left join vendor_rates r on r.vendor_id = c.vendor_id and r.property_name = c.property_name
    where c.date >= ${start} and c.date < ${end}
      ${approvedOnly ? sql`and c.status = 'approved'` : sql``}
    group by c.property_name, c.vendor_id, v.name, r.price
    order by vendor_name, c.property_name`;

  // 業者別にまとめる
  const byVendor = {};
  let grandTotal = 0, grandCount = 0, hasUnset = false;
  for (const x of rows) {
    const key = x.vendor_id || "none";
    (byVendor[key] ||= { vendor_id: x.vendor_id, vendor_name: x.vendor_name, items: [], subtotal: 0, count: 0, unset: false });
    const price = x.price != null ? Number(x.price) : null;
    const amount = price != null ? price * x.cnt : null;
    byVendor[key].items.push({ property_name: x.property_name, count: x.cnt, price, amount });
    byVendor[key].count += x.cnt;
    if (amount != null) byVendor[key].subtotal += amount; else { byVendor[key].unset = true; hasUnset = true; }
    if (amount != null) grandTotal += amount;
    grandCount += x.cnt;
  }
  const vendors = Object.values(byVendor).sort((a, b) => (a.vendor_name || "").localeCompare(b.vendor_name || ""));
  return NextResponse.json({ month, approvedOnly, vendors, grandTotal, grandCount, hasUnset });
}
