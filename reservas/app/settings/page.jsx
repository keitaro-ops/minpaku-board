"use client";
import "../globals.css";
import { useEffect, useState } from "react";

export default function Settings() {
  const [feeds, setFeeds] = useState([]);
  const [form, setForm] = useState({ property_name: "", area: "", platform: "airbnb", ical_url: "" });
  const [ren, setRen] = useState({ from: "", to: "" });
  const [renMsg, setRenMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [hooks, setHooks] = useState({});     // { 物件名: url }
  const [hookMsg, setHookMsg] = useState("");

  async function load() {
    const r = await fetch("/api/feeds");
    if (r.status === 401) { window.location.href = "/login"; return; }
    setFeeds((await r.json()).feeds);
    try {
      const h = await fetch("/api/webhooks");
      if (h.ok) {
        const map = {};
        (await h.json()).webhooks.forEach((w) => { map[w.property_name] = w.webhook_url; });
        setHooks(map);
      }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  async function saveHook(name, url) {
    setHookMsg("保存中…");
    const r = await fetch("/api/webhooks", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: name, webhook_url: url }) });
    const j = await r.json();
    setHookMsg(r.ok ? `「${name}」のWebhookを保存しました` : "エラー: " + (j.error || ""));
  }

  async function add(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await fetch("/api/feeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) { setForm({ property_name: "", area: "", platform: form.platform, ical_url: "" }); await load(); }
    else setMsg((await r.json()).error || "エラー");
    setBusy(false);
  }
  async function del(id) {
    if (!confirm("このフィードを削除しますか？")) return;
    await fetch("/api/feeds?id=" + id, { method: "DELETE" });
    await load();
  }
  async function sync() {
    setMsg("同期中…");
    const r = await fetch("/api/sync", { method: "POST" });
    const j = await r.json();
    setMsg(j.error ? "エラー: " + j.error : `同期完了：予約 ${j.reservations} 件${j.errors?.length ? `（取得失敗 ${j.errors.length} 件）` : ""}`);
  }
  async function rename(e) {
    e.preventDefault(); setRenMsg("");
    if (!ren.from || !ren.to.trim()) { setRenMsg("旧名の選択と新名の入力が必要です"); return; }
    setRenMsg("変更中…");
    const r = await fetch("/api/rename", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: ren.from, to: ren.to.trim() }) });
    const j = await r.json();
    if (r.ok) {
      setRenMsg("変更しました。ボードに反映するには下の「今すぐ同期」を押してください。");
      setRen({ from: "", to: "" });
      await load();
    } else setRenMsg("エラー: " + (j.error || ""));
  }
  // feeds から重複しない物件名リスト
  const propNames = [...new Set(feeds.map((f) => f.property_name))].sort();

  return (
    <div style={s.page}>
      <div style={s.head}>
        <a href="/" style={s.back}>← ボードに戻る</a>
        <h1 style={s.h1}>物件・iCal 設定</h1>
      </div>

      <form onSubmit={add} style={s.card}>
        <div style={s.grid}>
          <input style={s.in} placeholder="物件名（例: 渋谷ステイ201）" value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
          <input style={s.in} placeholder="エリア（任意）" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          <select style={s.in} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            <option value="airbnb">Airbnb</option>
            <option value="booking">Booking</option>
          </select>
        </div>
        <input style={{ ...s.in, width: "100%", marginTop: 10 }} placeholder="iCal エクスポート URL（.ics）" value={form.ical_url} onChange={(e) => setForm({ ...form, ical_url: e.target.value })} />
        <div style={s.row}>
          <button disabled={busy} style={s.btn}>追加</button>
          {msg && <span style={s.msg}>{msg}</span>}
        </div>
        <p style={s.hint}>
          Airbnb: リスティング → カレンダー → 空室状況 → カレンダーを接続 → 「カレンダーをエクスポート」の.ics URL。<br />
          Booking: エクストラネット → カレンダー → カレンダーを同期（エクスポート）の.ics URL。
        </p>
      </form>

      <form onSubmit={rename} style={{ ...s.card, marginTop: 16 }}>
        <div style={s.renTitle}>物件名を変更（入力ミスの修正・表記ゆれの統合）</div>
        <div style={s.renGrid}>
          <select style={s.in} value={ren.from} onChange={(e) => setRen({ ...ren, from: e.target.value })}>
            <option value="">変更したい物件を選択</option>
            {propNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ alignSelf: "center", color: "#8A94A6" }}>→</span>
          <input style={s.in} placeholder="新しい物件名" value={ren.to} onChange={(e) => setRen({ ...ren, to: e.target.value })} />
          <button style={s.btn}>変更</button>
        </div>
        {renMsg && <div style={{ ...s.msg, marginTop: 10 }}>{renMsg}</div>}
        <p style={s.hint}>
          選んだ名前の Airbnb・Booking 両方と、清掃・事前情報・分割・訂正の紐付けもまとめて新名に付け替えます。
          既存の物件名を新名にすると「統合」になります（例: 「AJITO203」を「AJITO 203」に）。
        </p>
      </form>

      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={s.renTitle}>Google Chat 通知（清掃後チェック完了を各部屋へ）</div>
        <p style={{ ...s.hint, marginTop: 0 }}>各物件のスペースで発行した Webhook URL を貼ると、清掃後チェックを「確認済み」にした時にその部屋へ通知します。空欄で保存すると解除。</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {propNames.map((n) => (
            <div key={n} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{n}{hooks[n] ? " 🔔" : ""}</span>
              <input style={s.in} placeholder="https://chat.googleapis.com/v1/spaces/... （未設定なら通知なし）"
                defaultValue={hooks[n] || ""} onBlur={(e) => saveHook(n, e.target.value.trim())} />
            </div>
          ))}
          {propNames.length === 0 && <span style={{ color: "#8A94A6" }}>先に物件（iCal）を登録してください。</span>}
        </div>
        {hookMsg && <div style={{ ...s.msg, marginTop: 10 }}>{hookMsg}</div>}
      </div>

      <div style={s.toolbar}>
        <div style={s.count}>{feeds.length} フィード</div>
        <button onClick={sync} style={s.syncBtn}>今すぐ同期</button>
      </div>

      <div style={s.list}>
        {feeds.map((f) => (
          <div key={f.id} style={s.item}>
            <div>
              <div style={s.name}>{f.property_name} <span style={{ ...s.badge, background: f.platform === "airbnb" ? "#FF5A5F" : "#0A3D91" }}>{f.platform}</span></div>
              <div style={s.url}>{f.ical_url}</div>
            </div>
            <button onClick={() => del(f.id)} style={s.del}>削除</button>
          </div>
        ))}
        {feeds.length === 0 && <div style={{ color: "#8A94A6", padding: 20 }}>まだフィードがありません。上のフォームから追加してください。</div>}
      </div>

      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&display=swap'); h1{font-family:'Space Grotesk',sans-serif;}`}</style>
    </div>
  );
}

const s = {
  page: { maxWidth: 760, margin: "0 auto", padding: "24px 18px 60px", fontFamily: "'Inter',system-ui,sans-serif" },
  head: { marginBottom: 18 },
  back: { fontSize: 13, color: "#0A3D91", textDecoration: "none" },
  h1: { fontSize: 22, margin: "8px 0 0" },
  card: { background: "#fff", border: "1px solid #E3E7ED", borderRadius: 14, padding: 18 },
  grid: { display: "grid", gridTemplateColumns: "1.4fr 1fr .8fr", gap: 10 },
  renTitle: { fontSize: 13, fontWeight: 600, marginBottom: 12 },
  renGrid: { display: "grid", gridTemplateColumns: "1.2fr auto 1.4fr auto", gap: 10, alignItems: "center" },
  in: { padding: "10px 12px", border: "1px solid #D8DDE5", borderRadius: 9, fontSize: 14, outline: "none", fontFamily: "inherit" },
  row: { display: "flex", alignItems: "center", gap: 14, marginTop: 12 },
  btn: { padding: "10px 20px", background: "#10151D", color: "#fff", border: 0, borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  msg: { fontSize: 13, color: "#475467" },
  hint: { fontSize: 11.5, color: "#8A94A6", lineHeight: 1.7, marginTop: 14, marginBottom: 0 },
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "26px 4px 12px" },
  count: { fontSize: 12.5, color: "#667085" },
  syncBtn: { padding: "8px 16px", background: "#fff", border: "1px solid #D8DDE5", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  item: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E3E7ED", borderRadius: 11, padding: "12px 14px" },
  name: { fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 },
  badge: { color: "#fff", fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 5 },
  url: { fontSize: 11, color: "#98A2B3", marginTop: 4, wordBreak: "break-all", maxWidth: 560 },
  del: { border: "1px solid #E7C9C9", color: "#B4272B", background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", flexShrink: 0 },
};
