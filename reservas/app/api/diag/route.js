import { NextResponse } from "next/server";
import { db } from "../../../lib/db.mjs";
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
  return NextResponse.json({ act, locks, timed });
}
