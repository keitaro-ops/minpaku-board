// 駐車場を共有する建物。物件名がこの接頭辞で始まる部屋どうしで共有する。
export const PARKING_BUILDINGS = { W14: 1 }; // 建物名: 駐車可能台数
export const buildingOf = (name) =>
  Object.keys(PARKING_BUILDINGS).find((k) => (name || "").startsWith(k + " ") || name === k);

// メッセージ通知の本文から「ゲスト（予約者）の発言」だけを取り出す。
// 本文は「名前 / 役割 / 発言」の繰り返し。補助ホスト・ホストの発言（駐車場の案内の定型文など）は除外する。
const ROLE = /^(予約者|ゲスト|補助ホスト|共同ホスト|ホスト|Airbnb.*|Guest|Booker|Co-?host|Host)$/i;
const GUEST_ROLE = /^(予約者|ゲスト|Guest|Booker)$/i;
export function guestOnly(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => ROLE.test(l))) return String(text || "");   // 役割表示が無い形式はそのまま
  const out = [];
  let role = null;
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && ROLE.test(lines[i + 1]) && !ROLE.test(lines[i])) { role = lines[i + 1]; i++; continue; }
    if (role && GUEST_ROLE.test(role)) out.push(lines[i]);
  }
  return out.join("\n");
}

// 予約ごとのゲストの駐車場連絡の状態
//   want: 必要 / no_car: 不要 / question: 質問のみ / none: 連絡なし
// msgs は sent_at 昇順。最新の「はっきりした発言（必要/不要）」を優先する。
export function contactOf(msgs) {
  if (!msgs || !msgs.length) return { status: "none", text: "", manual: false };
  const decisive = [...msgs].reverse().find((m) => m.intent === "want" || m.intent === "no_car");
  const m = decisive || msgs[msgs.length - 1];
  const thread = [...msgs].reverse().find((x) => x.thread_url);
  return { status: decisive ? decisive.intent : "question", text: m.text || "", manual: String(m.message_id || "").startsWith("manual:"),
           thread_url: thread ? thread.thread_url : "" };
}

// 列の追加は「列が無い時だけ」行う。ALTER TABLE は列が既にあってもテーブルの排他ロックを取りに行き、
// 待ちが発生すると後続の SELECT（予約一覧）まで止まるため。ロック待ちは3秒で諦める。
export async function ensureColumn(sql, table, column, type) {
  const [has] = await sql`select 1 from information_schema.columns where table_name = ${table} and column_name = ${column}`;
  if (has) return;
  await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '3s'`;
    await tx.unsafe(`alter table ${table} add column if not exists ${column} ${type}`);
  }).catch((e) => console.error("ensureColumn", table, column, e.message));
}

// 詰まった ALTER（ロック待ちのまま残ったもの）を片付ける。同期(15分毎)から呼ぶ。
export async function clearStuckParkingDDL(sql) {
  return sql`select pg_terminate_backend(pid) from pg_stat_activity
             where pid <> pg_backend_pid() and wait_event_type = 'Lock'
               and query ilike 'alter table parking_status%' and now() - query_start > interval '60 seconds'`.catch(() => []);
}

let _ensured = false;
// 駐車場関連テーブル（無ければ作成）
export async function ensureParkingTables(sql) {
  if (_ensured) return;
  await sql`create table if not exists parking_status (property_name text not null, check_in date not null, check_out date not null,
             parking boolean not null default false, primary key (property_name, check_in, check_out))`;
  await sql`create table if not exists parking_requests (
    id bigserial primary key, property_name text not null, check_in date not null, check_out date not null,
    text text default '', thread_url text default '', status text not null default 'pending',
    created_at timestamptz not null default now(), resolved_at timestamptz)`;
  await ensureColumn(sql, "parking_status", "source", "text");   // 'auto' | 'manual'（null=従来の手動）
  // ゲストの駐車場関連の発言（予約=物件+IN+OUT 単位）。手動🚗との食い違い検知に使う。
  await sql`create table if not exists parking_messages (
    message_id text primary key, property_name text not null, check_in date not null, check_out date not null,
    intent text not null, text text default '', thread_url text default '', sent_at timestamptz not null default now())`;
  // 食い違い通知の重複防止（同じ予約・同じ理由は1回だけ）
  await sql`create table if not exists parking_alerts (
    property_name text not null, check_in date not null, check_out date not null, reason text not null,
    created_at timestamptz not null default now(), primary key (property_name, check_in, check_out, reason))`;
  await sql`create table if not exists parking_notices (
    id bigserial primary key, subject text not null, body text not null,
    created_at timestamptz not null default now(), sent_at timestamptz)`;
  await sql`create table if not exists parking_meta (key text primary key, value text)`;
  _ensured = true;
}
