import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
export const runtime = "nodejs";

const fmtMD = (s) => { const [y, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}`; };

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.property_name || !b.check_in || !b.check_out)
    return NextResponse.json({ error: "必須項目が不足" }, { status: 400 });
  const sql = db();
  await sql`
    insert into ready_status (property_name, check_in, check_out, ready)
    values (${b.property_name}, ${b.check_in}, ${b.check_out}, ${!!b.ready})
    on conflict (property_name, check_in, check_out) do update set ready = excluded.ready`;

  // 「確認済み」にした時だけ、その物件の Google Chat へ通知
  if (b.ready) {
    try {
      const [hook] = await sql`select webhook_url from chat_webhooks where property_name = ${b.property_name}`;
      if (hook?.webhook_url) {
        const text = `\u2705 \u3010${b.property_name}\u3011\u6e05\u6383\u5f8c\u30c1\u30a7\u30c3\u30af\u5b8c\u4e86\n\u30c1\u30a7\u30c3\u30af\u30a4\u30f3 ${fmtMD(b.check_in)} \u301c ${fmtMD(b.check_out)}`;
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

  return NextResponse.json({ ok: true });
}
