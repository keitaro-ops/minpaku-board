import postgres from "postgres";

let _sql;
export function db() {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL, {
      ssl: "require",
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return _sql;
}

// role トークン（role名 + APP_SECRET のハッシュ）。Cookie の改ざん防止。
export async function roleToken(role) {
  const data = new TextEncoder().encode(`${role}::${process.env.APP_SECRET || ""}`);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// パスワード → 役割。環境変数で3種を設定。後方互換で DASHBOARD_PASSWORD は admin 扱い。
export function roleForPassword(pw) {
  if (!pw) return null;
  const admin = process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD;
  if (admin && pw === admin) return "admin";
  if (process.env.STAFF_PASSWORD && pw === process.env.STAFF_PASSWORD) return "staff";
  if (process.env.VIEWER_PASSWORD && pw === process.env.VIEWER_PASSWORD) return "viewer";
  return null;
}
