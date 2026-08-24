import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
import crypto from "crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

function tokenFor(role) {
  return crypto.createHash("sha256").update(`${role}::${process.env.APP_SECRET || ""}`).digest("hex");
}
function roleOf(req) {
  const t = req.cookies.get("rb_auth")?.value;
  if (!t) return null;
  for (const r of ["admin", "staff", "cleanlead", "viewer"]) if (t === tokenFor(r)) return r;
  return null;
}

export async function GET() {
  const sql = db();
  const rows = await sql`
    select c.id, c.property_name, to_char(c.date,'YYYY-MM-DD') as date, c.kind, c.memo,
           c.vendor_id, c.status, v.name as vendor_name
    from cleanings c left join vendors v on v.id = c.vendor_id
    order by c.date`;
  return NextResponse.json({ cleanings: rows });
}

export async function POST(req) {
  const role = roleOf(req);
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !DATE_RE.test(b.date || ""))
    return NextResponse.json({ error: "物件名と日付(YYYY-MM-DD)が必要です" }, { status: 400 });
  // 清掃責任者は過去日を追加できない（当日以降のみ）
  if (role === "cleanlead" && b.date < today())
    return NextResponse.json({ error: "過去の日付には登録できません（管理者・運用者に依頼してください）" }, { status: 403 });
  const kind = ["inhouse", "outsourced"].includes(b.kind) ? b.kind : "inhouse";
  const vendorId = b.vendor_id ? Number(b.vendor_id) : null;
  // 業者が入れたものは「申請中」。管理者・運用者は既定で「承認済み」（status指定も可）。
  let status = role === "cleanlead" ? "pending" : (b.status === "pending" ? "pending" : "approved");
  const sql = db();
  const [row] = await sql`
    insert into cleanings (property_name, date, kind, memo, vendor_id, status)
    values (${b.property_name}, ${b.date}, ${kind}, ${(b.memo || "").slice(0, 300)}, ${vendorId}, ${status})
    returning id, property_name, to_char(date,'YYYY-MM-DD') as date, kind, memo, vendor_id, status`;
  return NextResponse.json({ cleaning: row });
}

export async function PATCH(req) {
  const role = roleOf(req);
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  const sql = db();
  const [cur] = await sql`select id, status from cleanings where id = ${b.id}`;
  if (!cur) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isManager = role === "admin" || role === "staff";
  // 清掃責任者は「申請中」のものだけ編集可。承認済みは触れない。ステータスも変えられない。
  if (role === "cleanlead") {
    if (cur.status !== "pending")
      return NextResponse.json({ error: "承認済みのため変更できません" }, { status: 403 });
  }

  const kind = ["inhouse", "outsourced"].includes(b.kind) ? b.kind : "inhouse";
  const vendorId = b.vendor_id ? Number(b.vendor_id) : null;

  // ステータス変更（承認/差し戻し）は管理者・運用者のみ
  let statusClause = sql``;
  if (isManager && (b.status === "approved" || b.status === "pending")) {
    await sql`update cleanings set kind=${kind}, memo=${(b.memo || "").slice(0,300)}, vendor_id=${vendorId}, status=${b.status} where id=${b.id}`;
  } else {
    await sql`update cleanings set kind=${kind}, memo=${(b.memo || "").slice(0,300)}, vendor_id=${vendorId} where id=${b.id}`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const role = roleOf(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sql = db();
  const [cur] = await sql`select status from cleanings where id = ${id}`;
  if (!cur) return NextResponse.json({ ok: true });
  // 清掃責任者は申請中のみ削除可
  if (role === "cleanlead" && cur.status !== "pending")
    return NextResponse.json({ error: "承認済みのため削除できません" }, { status: 403 });
  await sql`delete from cleanings where id = ${id}`;
  return NextResponse.json({ ok: true });
}
