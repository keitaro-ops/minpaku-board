// 駐車場を共有する建物。物件名がこの接頭辞で始まる部屋どうしで共有する。
export const PARKING_BUILDINGS = { W14: 1 }; // 建物名: 駐車可能台数
export const buildingOf = (name) =>
  Object.keys(PARKING_BUILDINGS).find((k) => (name || "").startsWith(k + " ") || name === k);

// 予約ごとのゲストの駐車場連絡の状態
//   want: 必要 / no_car: 不要 / question: 質問のみ / none: 連絡なし
// msgs は sent_at 昇順。最新の「はっきりした発言（必要/不要）」を優先する。
export function contactOf(msgs) {
  if (!msgs || !msgs.length) return { status: "none", text: "", manual: false };
  const decisive = [...msgs].reverse().find((m) => m.intent === "want" || m.intent === "no_car");
  const m = decisive || msgs[msgs.length - 1];
  return { status: decisive ? decisive.intent : "question", text: m.text || "", manual: String(m.message_id || "").startsWith("manual:") };
}

// 駐車場関連テーブル（無ければ作成）
export async function ensureParkingTables(sql) {
  await sql`create table if not exists parking_status (property_name text not null, check_in date not null, check_out date not null,
             parking boolean not null default false, primary key (property_name, check_in, check_out))`;
  await sql`create table if not exists parking_requests (
    id bigserial primary key, property_name text not null, check_in date not null, check_out date not null,
    text text default '', thread_url text default '', status text not null default 'pending',
    created_at timestamptz not null default now(), resolved_at timestamptz)`;
  await sql`alter table parking_status add column if not exists source text`;   // 'auto' | 'manual'（null=従来の手動）
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
}
