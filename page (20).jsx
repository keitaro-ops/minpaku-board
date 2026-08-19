"use client";
import "../globals.css";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) window.location.href = "/";
    else { setErr((await r.json()).error || "エラー"); setBusy(false); }
  }

  return (
    <div style={s.wrap}>
      <form onSubmit={submit} style={s.card}>
        <div style={s.logo}>◲</div>
        <h1 style={s.h1}>予約統合ボード</h1>
        <p style={s.sub}>共有パスワードを入力してください</p>
        <input
          type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="パスワード" style={s.input} autoFocus
        />
        {err && <div style={s.err}>{err}</div>}
        <button disabled={busy} style={{ ...s.btn, opacity: busy ? 0.6 : 1 }}>
          {busy ? "確認中…" : "入る"}
        </button>
      </form>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap');
        h1 { font-family: 'Space Grotesk', sans-serif; }
      `}</style>
    </div>
  );
}

const s = {
  wrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 },
  card: { background: "#fff", width: "100%", maxWidth: 360, borderRadius: 18, padding: 32, boxShadow: "0 12px 40px rgba(0,0,0,.10)", textAlign: "center" },
  logo: { width: 48, height: 48, borderRadius: 12, background: "#10151D", color: "#fff", display: "grid", placeItems: "center", fontSize: 26, margin: "0 auto 16px" },
  h1: { fontSize: 20, margin: "0 0 4px" },
  sub: { fontSize: 13, color: "#667085", margin: "0 0 22px" },
  input: { width: "100%", padding: "12px 14px", border: "1px solid #D8DDE5", borderRadius: 10, fontSize: 15, outline: "none", marginBottom: 12 },
  err: { color: "#C0392B", fontSize: 13, marginBottom: 12 },
  btn: { width: "100%", padding: "12px 14px", background: "#10151D", color: "#fff", border: 0, borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer" },
};
