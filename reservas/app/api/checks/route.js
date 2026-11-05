import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

const fmtMD = (s) => { const [y, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}`; };

// 日付ベースの清掃チェック（予約に紐づかない。長期空室でも「いつ点検/清掃に入ったか」を記録できる）
export async function GET() {
  const sql = db();
  try {
    const rows = await sql`select property_name, to_char(date,'YYYY-MM-DD') as date, memo from check_log order by date`;
    return NextResponse.json({ checks: rows });
  } catch {
    // テーブル未作成でも board を壊さない
    return NextResponse.json({ checks: [] });
  }
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || ""))
    return NextResponse.json({ error: "物件名と日付(YYYY-MM-DD)が必要です" }, { status: 400 });
  const sql = db();
  // 保存先テーブルを自動作成（初回チェックで自動セットアップ。Supabaseでの手動SQL不要）
  await sql`
    create table if not exists check_log (
      property_name text not null,
      date date not null,
      memo text default '',
      updated_at timestamptz not null default now(),
      primary key (property_name, date)
    )`;
  if (b.on === false) {
    await sql`delete from check_log where property_name = ${b.property_name} and date = ${b.date}`;
    return NextResponse.json({ ok: true, checked: false });
  }
  // 既に付いているかを確認（新規チェック時だけ通知し、重複通知を避ける）
  const [existing] = await sql`select 1 as e from check_log where property_name = ${b.property_name} and date = ${b.date}`;
  await sql`
    insert into check_log (property_name, date, memo)
    values (${b.property_name}, ${b.date}, ${(b.memo || "").slice(0, 200)})
    on conflict (property_name, date) do update set memo = excluded.memo, updated_at = now()`;

  // 新しくチェックを付けた時だけ、その物件の Google Chat へ通知（旧・清掃後チェックと同じ連携を維持）
  if (!existing) {
    try {
      const [hook] = await sql`select webhook_url from chat_webhooks where property_name = ${b.property_name}`;
      if (hook?.webhook_url) {
        const text = `✅ 【${b.property_name}】清掃チェック完了\n日付 ${fmtMD(b.date)}`;
        await fetch(hook.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ text }),
        });
      }
    } catch (e) {
      console.error("chat notify failed", e);
    }
  }

  return NextResponse.json({ ok: true, checked: true });
}
