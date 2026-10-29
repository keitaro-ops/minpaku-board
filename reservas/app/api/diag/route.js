import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
import { GET as reservationsGET } from "../reservations/route.js";
export const runtime = "nodejs";
export const maxDuration = 60;
// 一時的な診断用（管理者のみ・POST）。DBの待ち状況と、予約一覧の各クエリの所要時間を返す。
export async function POST() {
  const sql = db();
  const act = await sql`select pid, state, wait_event_type, wait_event, round(extract(epoch from now() - query_start))::int as sec,
                               left(regexp_replace(query, '\s+', ' ', 'g'), 90) as q
                        from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
                        order by query_start limit 30`.catch((e) => [{ error: e.message }]);
  const locks = await sql`select relation::regclass::text as rel, mode, granted, count(*)::int as n from pg_locks
                          where relation is not null and relation::regclass::text like 'parking%' group by 1,2,3`.catch((e) => [{ error: e.message }]);
  const timed = {};
  const T = async (name, q) => { const t = Date.now(); try { const r = await q; timed[name] = `${Date.now() - t}ms rows=${r.length}`; } catch (e) { timed[name] = "ERR " + e.message; } };
  await T("reservations", sql`select property_name, check_in, check_out from reservations`);
  await T("parking_status", sql`select * from parking_status`);
  await T("parking_messages", sql`select message_id from parking_messages`);
  await T("guest_counts", sql`select res_code from guest_counts`);
  await T("cleaning_status", sql`select * from cleaning_status`);
  await T("memo_status", sql`select * from memo_status`);
  const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("TIMEOUT"), ms))]);
  const QS = [
    () => sql`select property_name, area, platform, type,
                 to_char(check_in,'YYYY-MM-DD') as check_in,
                 to_char(check_out,'YYYY-MM-DD') as check_out,
                 res_code, res_url from reservations`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, type from overrides`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, submitted from checkin_status`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, status, memo from cleaning_status`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, boundaries from splits`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, ready from ready_status`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, memo from memo_status`,
    () => sql`select res_code, adults, children, guest_name from guest_counts`,
    () => sql`select res_code from change_flags where acknowledged = false`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, adults, children from guest_manual`,
    () => sql`select property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, parking from parking_status`.catch(() => []),
    () => sql`select message_id, property_name, to_char(check_in,'YYYY-MM-DD') as check_in, to_char(check_out,'YYYY-MM-DD') as check_out, intent, text
          from parking_messages order by sent_at`.catch(() => [])
  ];
  for (let i = 0; i < QS.length; i++) { const t = Date.now(); const r = await race(Promise.resolve(QS[i]()), 6000); timed["q" + i] = (r === "TIMEOUT" ? "TIMEOUT" : "ok rows=" + r.length) + " " + (Date.now() - t) + "ms"; }
  if (false) { const t = Date.now(); const r = await reservationsGET(); const body = await r.text(); timed.reservations_route = `${Date.now() - t}ms status=${r.status} bytes=${body.length}`; }
  return NextResponse.json({ act, locks, timed });
}
