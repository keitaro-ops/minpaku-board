"use client";
import { useEffect, useState } from "react";

const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
function monthShift(ym, delta) {
  let [y, m] = ym.split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function Billing() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [approvedOnly, setApprovedOnly] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/billing?month=${month}${approvedOnly ? "&approved=1" : ""}`);
      if (r.status === 401 || r.status === 403) { window.location.href = "/"; return; }
      setData(await r.json());
    } catch { setData(null); }
    setLoading(false);
  }
  useEffect(() => { load(); }, [month, approvedOnly]);

  function downloadCSV() {
    if (!data) return;
    const rows = [["業者", "物件", "日付", "単価", "金額"]];
    data.vendors.forEach((v) => {
      v.items.forEach((it) => {
        (it.dates || []).forEach((d) => {
          rows.push([v.vendor_name, it.property_name, d, it.price ?? "未設定", it.price ?? ""]);
        });
      });
      rows.push([v.vendor_name + " 小計", "", v.count + "件", "", v.subtotal]);
    });
    rows.push(["総合計", "", data.grandCount + "件", "", data.grandTotal]);
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `清掃費_${month}${approvedOnly ? "_承認済み" : ""}.csv`;
    a.click();
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <a href="/" style={s.back}>← ボードに戻る</a>
          <h1 style={s.h1}>清掃費 月次集計</h1>
        </div>
        <button style={s.csv} onClick={downloadCSV} disabled={!data || !data.vendors?.length}>CSVダウンロード</button>
      </div>

      <div style={s.bar}>
        <button style={s.navBtn} onClick={() => setMonth(monthShift(month, -1))}>◀ 前月</button>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={s.month} />
        <button style={s.navBtn} onClick={() => setMonth(monthShift(month, 1))}>翌月 ▶</button>
        <label style={s.chk}><input type="checkbox" checked={approvedOnly} onChange={() => setApprovedOnly((v) => !v)} /> 承認済みのみ</label>
      </div>

      {loading && <div style={s.muted}>読み込み中…</div>}
      {!loading && data && (
        <>
          <div style={s.total}>
            <span>総合計</span>
            <span style={s.totalV}>{yen(data.grandTotal)}</span>
            <span style={s.totalSub}>清掃 {data.grandCount} 件{data.hasUnset ? " ・ 単価未設定あり" : ""}</span>
          </div>

          {data.vendors.length === 0 && <div style={s.muted}>この月の清掃はありません。</div>}

          {data.vendors.map((v) => (
            <div key={v.vendor_id || "none"} style={s.card}>
              <div style={s.cardHead}>
                <b>{v.vendor_name}</b>
                <span style={s.sub}>{v.count} 件 ／ 小計 {yen(v.subtotal)}{v.unset ? "（未設定あり）" : ""}</span>
              </div>
              <table style={s.table}>
                <thead>
                  <tr><th style={s.th}>物件</th><th style={s.thR}>回数</th><th style={s.thR}>単価</th><th style={s.thR}>金額</th></tr>
                </thead>
                <tbody>
                  {v.items.map((it, i) => (
                    <tr key={i}>
                      <td style={s.td}>
                        {it.property_name}
                        <div style={s.dates}>{(it.dates || []).map((d) => d.slice(5).replace("-", "/")).join("・")}</div>
                      </td>
                      <td style={s.tdR}>{it.count}</td>
                      <td style={s.tdR}>{it.price != null ? yen(it.price) : <span style={s.unset}>未設定</span>}</td>
                      <td style={s.tdR}>{it.amount != null ? yen(it.amount) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const s = {
  wrap: { maxWidth: 860, margin: "0 auto", padding: "24px 16px 60px", fontFamily: "Inter, system-ui, sans-serif", color: "#10151D" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  back: { fontSize: 13, color: "#0F766E", textDecoration: "none" },
  h1: { fontSize: 22, margin: "6px 0 0" },
  csv: { padding: "10px 16px", background: "#0F766E", color: "#fff", border: 0, borderRadius: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  bar: { display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" },
  navBtn: { padding: "8px 12px", border: "1px solid #D8DDE5", background: "#fff", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" },
  month: { padding: "8px 10px", border: "1px solid #D8DDE5", borderRadius: 8, fontFamily: "inherit" },
  chk: { fontSize: 13, color: "#475467", display: "flex", gap: 6, alignItems: "center", marginLeft: 6 },
  total: { display: "flex", alignItems: "baseline", gap: 12, background: "#10151D", color: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 18 },
  totalV: { fontSize: 26, fontWeight: 700 },
  totalSub: { fontSize: 12, color: "#B6BECB", marginLeft: "auto" },
  card: { border: "1px solid #E3E7ED", borderRadius: 12, padding: 16, marginBottom: 14 },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  sub: { fontSize: 12.5, color: "#667085" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: 11.5, color: "#8A94A6", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid #EDF0F4" },
  thR: { textAlign: "right", fontSize: 11.5, color: "#8A94A6", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid #EDF0F4" },
  td: { fontSize: 13, padding: "7px 8px", borderBottom: "1px solid #F4F6F8" },
  tdR: { fontSize: 13, padding: "7px 8px", borderBottom: "1px solid #F4F6F8", textAlign: "right" },
  unset: { color: "#B42318", fontSize: 12 },
  dates: { fontSize: 11, color: "#8A94A6", marginTop: 2 },
  muted: { color: "#8A94A6", padding: "20px 0" },
};
