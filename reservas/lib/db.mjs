import postgres from "postgres";

let _sql;
export function db() {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL, {
      ssl: "require",
      max: 1,               // サーバーレスはプーラー枯渇を避けるため接続を絞る
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,       // Supabase transaction pooler 対応
    });
  }
  return _sql;
}

export async function authToken(password) {
  const data = new TextEncoder().encode(`${password}::${process.env.APP_SECRET || ""}`);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
