import postgres from "postgres";

let _sql;
export function db() {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL, {
      ssl: "require",
      max: 3,
      idle_timeout: 20,
      prepare: false,
    });
  }
  return _sql;
}

// パスワード → Cookie 用トークン（Web Crypto / node・edge 両対応）
export async function authToken(password) {
  const data = new TextEncoder().encode(`${password}::${process.env.APP_SECRET || ""}`);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
