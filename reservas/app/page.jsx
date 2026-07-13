"use client";
import "./globals.css";
import { useEffect, useMemo, useState } from "react";

const DAY_MS = 86400000;
const DAY_W = 46;
const ROW_H = 46;
const PLATFORMS = {
  airbnb: { label: "Airbnb", bar: "#FF5A5F", ink: "#B4272B" },
  booking: { label: "Booking", bar: "#0A3D91", ink: "#0A3D91" },
};
const WD = ["日", "月", "火", "水", "木", "金", "土"];

const parseDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);
const fmtMD = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

export default function Dashboard() {
  const [today] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState(null);
  const [view, setView] = useState("timeline");
  const [plat, setPlat] = useState({ airbnb: true, booking: true });
  const [showBlocks, setShowBlocks] = useState(true);
  const [needInfoOnly, setNeedInfoOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [sort, setSort] = useState({ key: "check_in", dir: 1 });
  const [syncing, setSyncing] = useState(false);
  const [winStart, setWinStart] = useState(() => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
    return d;
  });

  async function load() {
    const r = await fetch("/api/reservations");
    if (r.status === 401) { window.location.href = "/login"; return; }
    const j = await r.json();
    setData(j.reservations.map((x, i) => ({
      ...x, id: i,
      info_submitted: !!x.info_submitted,
      ci: parseDate(x.check_in), co: parseDate(x.check_out),
    })));
  }
  useEffect(() => { load(); }, []);

  async function manualSync() {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST" });
    await load();
    setSyncing(false);
  }
  async function toggleCheckin(r) {
    await fetch("/api/checkin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: r.property_name, check_in: r.check_in, check_out: r.check_out, submitted: !r.info_submitted }),
    });
    await load();
    setSel(null);
  }
  async function toggleType(r) {
    const next = r.type === "booking" ? "block" : "booking";
    await fetch("/api/override", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: r.property_name, check_in: r.check_in, check_out: r.check_out, type: next }),
    });
    await load();
    setSel(null);
  }

  const props = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const r of data) if (!m.has(r.property_name)) m.set(r.property_name, r.area || "");
    return [...m.entries()].map(([name, area]) => ({ name, area })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.filter((r) => {
      if (!plat[r.platform]) return false;
      if (r.type === "block" && !showBlocks) return false;
      if (needInfoOnly && (r.type !== "booking" || r.info_submitted)) return false;
      if (s && !`${r.property_name} ${r.area || ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [data, plat, showBlocks, needInfoOnly, q]);

  const stats = useMemo(() => {
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    let ab = 0, bk = 0, nb = 0, need = 0;
    filtered.forEach((r) => {
      if (r.type !== "booking") return;
      if (r.platform === "airbnb") ab++; else bk++;
      if (!r.info_submitted && r.co >= today) need++;
      const a = Math.max(r.ci, mStart), b = Math.min(r.co, mEnd);
      if (b > a) nb += Math.round((b - a) / DAY_MS);
    });
    const cap = Math.max(1, props.length) * Math.round((mEnd - mStart) / DAY_MS);
    return { ab, bk, total: ab + bk, occ: Math.round((nb / cap) * 100), need };
  }, [filtered, props, today]);

  const days = useMemo(
    () => Array.from({ length: 35 }, (_, i) => new Date(winStart.getTime() + i * DAY_MS)),
    [winStart]
  );

  const listRows = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      let x = a[key], y = b[key];
      if (key === "check_in" || key === "check_out") { x = +parseDate(x); y = +parseDate(y); }
      if (typeof x === "string") return (x || "").localeCompare(y || "") * dir;
      return (x - y) * dir;
    });
    return rows;
  }, [filtered, sort]);
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  if (!data) return <div style={{ padding: 40, color: "#667085" }}>読み込み中…</div>;

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="hdr">
        <div className="hdr-left">
          <div className="logo">◲</div>
          <div>
            <h1>予約統合ボード</h1>
            <p className="sub">{props.length} 物件 · Airbnb / Booking を統合 · 隣接予約も別件で表示</p>
          </div>
        </div>
        <div className="chips">
          <Chip color="#10151D" label="予約 合計" value={stats.total} />
          <Chip color={PLATFORMS.airbnb.bar} label="Airbnb" value={stats.ab} />
          <Chip color={PLATFORMS.booking.bar} label="Booking" value={stats.bk} />
          <Chip color="#0F766E" label="今月 稼働率" value={stats.occ + "%"} />
          <Chip color="#F59E0B" label="事前情報 未提出" value={stats.need} />
        </div>
      </header>

      <div className="body">
        <aside className="side">
          <input className="search" placeholder="物件・エリアを検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <FilterGroup title="サイト">
            {Object.entries(PLATFORMS).map(([k, v]) => (
              <label key={k} className="flt">
                <input type="checkbox" checked={plat[k]} onChange={() => setPlat((p) => ({ ...p, [k]: !p[k] }))} />
                <span className="swatch" style={{ background: v.bar }} />{v.label}
              </label>
            ))}
          </FilterGroup>
          <FilterGroup title="表示">
            <label className="flt">
              <input type="checkbox" checked={showBlocks} onChange={() => setShowBlocks((v) => !v)} />
              ブロックも表示
            </label>
            <label className="flt">
              <input type="checkbox" checked={needInfoOnly} onChange={() => setNeedInfoOnly((v) => !v)} />
              事前情報 未提出のみ
            </label>
          </FilterGroup>
          <div className="legend">
            <div className="lg-row"><span className="swatch" style={{ background: PLATFORMS.airbnb.bar }} />Airbnb 予約</div>
            <div className="lg-row"><span className="swatch" style={{ background: PLATFORMS.booking.bar }} />Booking 予約</div>
            <div className="lg-row"><span className="swatch hatch" />ブロック（件数外）</div>
            <div className="lg-row"><span className="needdot" style={{ position: "static", boxShadow: "none" }} />事前情報 未提出</div>
          </div>
          <div className="side-actions">
            <button className="ghost" onClick={manualSync} disabled={syncing}>{syncing ? "同期中…" : "今すぐ同期"}</button>
            <a className="ghost" href="/settings">物件・iCal設定</a>
            <button className="ghost" onClick={async () => { await fetch("/api/logout", { method: "POST" }); window.location.href = "/login"; }}>ログアウト</button>
          </div>
        </aside>

        <main className="main">
          <div className="toolbar">
            <div className="seg">
              <button className={view === "timeline" ? "on" : ""} onClick={() => setView("timeline")}>タイムライン</button>
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>リスト</button>
            </div>
            {view === "timeline" && (
              <div className="nav">
                <button onClick={() => setWinStart(new Date(winStart.getTime() - 7 * DAY_MS))}>‹ 前週</button>
                <button onClick={() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); setWinStart(d); }}>今日</button>
                <button onClick={() => setWinStart(new Date(winStart.getTime() + 7 * DAY_MS))}>次週 ›</button>
              </div>
            )}
            <div className="count mono">予約 {filtered.filter((r) => r.type === "booking").length} 件</div>
          </div>

          {props.length === 0 ? (
            <div className="empty">
              まだ予約がありません。「物件・iCal設定」で各サイトのエクスポートURLを登録し、「今すぐ同期」を押してください。
            </div>
          ) : view === "timeline" ? (
            <Timeline days={days} props={props} rows={filtered} today={today} onSel={setSel} />
          ) : (
            <ListView rows={listRows} sort={sort} onSort={toggleSort} onSel={setSel} />
          )}
        </main>
      </div>

      {sel && <Detail r={sel} onClose={() => setSel(null)} onToggle={toggleType} onCheckin={toggleCheckin} />}
    </div>
  );
}

function Timeline({ days, props, rows, today, onSel }) {
  const gridW = days.length * DAY_W;
  const todayIdx = dayDiff(today, days[0]);
  return (
    <div className="tl-wrap">
      <div className="tl-scroll">
        <div style={{ minWidth: 220 + gridW }}>
          <div className="tl-head">
            <div className="tl-corner">物件</div>
            <div style={{ display: "flex", width: gridW }}>
              {days.map((d, i) => {
                const wknd = d.getDay() === 0 || d.getDay() === 6;
                const isToday = dayDiff(d, today) === 0;
                return (
                  <div key={i} className={"tl-day" + (wknd ? " wknd" : "") + (isToday ? " today" : "")} style={{ width: DAY_W }}>
                    <span className="wd">{WD[d.getDay()]}</span><span className="md mono">{d.getDate()}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ position: "relative" }}>
            {todayIdx >= 0 && todayIdx < days.length && (
              <div className="tl-nowline" style={{ left: 220 + todayIdx * DAY_W + DAY_W / 2 }} />
            )}
            {props.map((p) => {
              const rs = rows.filter((r) => r.property_name === p.name);
              const cnt = rs.filter((r) => r.type === "booking").length;
              return (
                <div key={p.name} className="tl-row" style={{ height: ROW_H }}>
                  <div className="tl-name">
                    <span className="nm">{p.name}</span>
                    <span className="cnt-badge mono">{cnt}件</span>
                  </div>
                  <div className="tl-lane" style={{ width: gridW }}>
                    {days.map((d, i) => {
                      const wknd = d.getDay() === 0 || d.getDay() === 6;
                      return <div key={i} className={"cell" + (wknd ? " wknd" : "")} style={{ width: DAY_W }} />;
                    })}
                    {rs.map((r) => {
                      const off = dayDiff(r.ci, days[0]);
                      if (off + r.nights <= 0 || off >= days.length) return null;
                      const left = off * DAY_W + DAY_W / 2 + 3;
                      const width = r.nights * DAY_W - 6;
                      const pf = PLATFORMS[r.platform] || PLATFORMS.airbnb;
                      const block = r.type === "block";
                      return (
                        <button key={r.id} className={"bar" + (block ? " block" : "")}
                          style={{ left, width, top: 6, height: ROW_H - 12, background: block ? "transparent" : pf.bar, borderColor: block ? "#B6BECB" : pf.bar }}
                          onClick={() => onSel(r)} title={`${p.name} ${fmtMD(r.ci)}〜${fmtMD(r.co)}（${r.nights}泊）${!block && !r.info_submitted ? " ・事前情報 未提出" : ""}`}>
                          {!block && !r.info_submitted && <span className="needdot" />}
                          <span className="bar-lbl" style={{ color: block ? "#5A6472" : "#fff" }}>{block ? "ブロック" : r.nights + "泊"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ListView({ rows, sort, onSort, onSel }) {
  const cols = [["property_name", "物件"], ["check_in", "IN"], ["check_out", "OUT"], ["nights", "泊"], ["platform", "サイト"], ["type", "区分"], ["info_submitted", "事前情報"], ["res_code", "予約コード"]];
  return (
    <div className="lst-wrap">
      <table className="lst">
        <thead><tr>{cols.map(([k, l]) => (
          <th key={k} onClick={() => onSort(k)} className={sort.key === k ? "srt" : ""}>{l}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>
        ))}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const pf = PLATFORMS[r.platform] || PLATFORMS.airbnb;
            return (
              <tr key={r.id} className={r.type === "block" ? "blk" : ""} onClick={() => onSel(r)}>
                <td className="strong">{r.property_name}</td>
                <td className="mono">{fmtMD(r.ci)}({WD[r.ci.getDay()]})</td>
                <td className="mono">{fmtMD(r.co)}({WD[r.co.getDay()]})</td>
                <td className="mono">{r.nights}</td>
                <td><span className="tag" style={{ background: pf.bar }}>{pf.label}</span></td>
                <td>{r.type === "booking" ? "予約" : <span className="muted">ブロック</span>}</td>
                <td>{r.type !== "booking" ? <span className="muted">—</span> : r.info_submitted ? <span className="ok">済</span> : <span className="need">未</span>}</td>
                <td className="mono muted">{r.res_code || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ r, onClose, onToggle, onCheckin }) {
  const pf = PLATFORMS[r.platform] || PLATFORMS.airbnb;
  const block = r.type === "block";
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-top" style={{ borderColor: block ? "#B6BECB" : pf.bar }}>
          <span className="tag" style={{ background: block ? "#8A94A6" : pf.bar }}>{block ? "ブロック" : pf.label}</span>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <h2>{r.property_name}</h2>
        <div className="m-prop">{r.area}</div>
        <dl className="m-grid">
          <div><dt>チェックイン</dt><dd className="mono">{fmtMD(r.ci)} ({WD[r.ci.getDay()]})</dd></div>
          <div><dt>チェックアウト</dt><dd className="mono">{fmtMD(r.co)} ({WD[r.co.getDay()]})</dd></div>
          <div><dt>泊数</dt><dd className="mono">{r.nights}泊</dd></div>
          <div><dt>予約コード</dt><dd className="mono">{r.res_code || "—"}</dd></div>
        </dl>
        {!block && (
          <div className={"m-info " + (r.info_submitted ? "done" : "todo")}>
            <span>事前チェックイン情報：<b>{r.info_submitted ? "提出済み" : "未提出"}</b></span>
            <button onClick={() => onCheckin(r)}>{r.info_submitted ? "未提出に戻す" : "提出済みにする"}</button>
          </div>
        )}
        {!block && r.res_url && <a className="m-link" href={r.res_url} target="_blank" rel="noreferrer">予約ページを開く ↗</a>}
        {!block && !r.res_url && r.platform === "booking" && <a className="m-link" href="https://admin.booking.com" target="_blank" rel="noreferrer">Bookingエクストラネットを開く ↗</a>}
        <button className="m-toggle" onClick={() => onToggle(r)}>
          {block ? "「予約」に戻す" : "「ブロック」に訂正する"}
        </button>
      </div>
    </div>
  );
}

function Chip({ color, label, value }) {
  return <div className="stat"><span className="dot" style={{ background: color }} /><div><div className="stat-v mono">{value}</div><div className="stat-l">{label}</div></div></div>;
}
function FilterGroup({ title, children }) { return <div className="fg"><div className="fg-t">{title}</div>{children}</div>; }

const CSS = `
.app { font-family:'Inter',system-ui,sans-serif; color:#10151D; background:#EEF1F5; min-height:100vh; }
.mono { font-family:'JetBrains Mono',ui-monospace,monospace; font-variant-numeric:tabular-nums; }
h1,h2 { font-family:'Space Grotesk',sans-serif; margin:0; }
.hdr { display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap; padding:16px 22px; background:#fff; border-bottom:1px solid #E3E7ED; }
.hdr-left { display:flex; align-items:center; gap:14px; }
.logo { width:40px; height:40px; border-radius:10px; background:#10151D; color:#fff; display:grid; place-items:center; font-size:22px; }
.hdr h1 { font-size:19px; letter-spacing:-.01em; }
.sub { margin:2px 0 0; font-size:12.5px; color:#667085; }
.chips { display:flex; gap:10px; flex-wrap:wrap; }
.stat { display:flex; align-items:center; gap:9px; background:#F7F8FA; border:1px solid #E3E7ED; border-radius:11px; padding:8px 13px; }
.stat .dot { width:9px; height:9px; border-radius:3px; }
.stat-v { font-size:16px; font-weight:600; line-height:1; }
.stat-l { font-size:10.5px; color:#667085; margin-top:3px; }
.body { display:flex; align-items:flex-start; }
.side { width:210px; flex:0 0 210px; padding:18px 16px; border-right:1px solid #E3E7ED; background:#fff; min-height:calc(100vh - 74px); }
.main { flex:1; min-width:0; padding:16px 20px 40px; }
.search { width:100%; padding:9px 11px; border:1px solid #D8DDE5; border-radius:9px; font-size:13px; margin-bottom:18px; outline:none; }
.fg { margin-bottom:18px; }
.fg-t { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:#8A94A6; margin-bottom:9px; }
.flt { display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 0; cursor:pointer; }
.flt input { accent-color:#10151D; }
.swatch { width:13px; height:13px; border-radius:4px; display:inline-block; }
.swatch.hatch { background:repeating-linear-gradient(45deg,#B6BECB,#B6BECB 3px,#fff 3px,#fff 6px); border:1px solid #C3CAD5; }
.legend { border-top:1px solid #EDF0F4; padding-top:14px; margin-bottom:16px; }
.lg-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#475467; padding:3px 0; }
.side-actions { display:flex; flex-direction:column; gap:8px; border-top:1px solid #EDF0F4; padding-top:14px; }
.ghost { text-align:left; border:1px solid #D8DDE5; background:#fff; border-radius:8px; padding:8px 11px; font-size:12.5px; cursor:pointer; font-family:inherit; color:#10151D; text-decoration:none; }
.ghost:hover { background:#F5F7FA; }
.toolbar { display:flex; align-items:center; gap:14px; margin-bottom:14px; flex-wrap:wrap; }
.seg { display:inline-flex; background:#E4E8EE; border-radius:9px; padding:3px; }
.seg button { border:0; background:transparent; padding:7px 15px; font-size:13px; font-weight:600; border-radius:7px; cursor:pointer; color:#5A6472; font-family:inherit; }
.seg button.on { background:#fff; color:#10151D; box-shadow:0 1px 2px rgba(0,0,0,.08); }
.nav { display:flex; gap:6px; }
.nav button { border:1px solid #D8DDE5; background:#fff; border-radius:8px; padding:6px 11px; font-size:12.5px; cursor:pointer; font-family:inherit; }
.count { margin-left:auto; font-size:12.5px; color:#667085; }
.empty { background:#fff; border:1px dashed #C9D0DA; border-radius:12px; padding:40px 24px; text-align:center; color:#667085; font-size:14px; line-height:1.7; }
.tl-wrap { background:#fff; border:1px solid #E3E7ED; border-radius:12px; overflow:hidden; }
.tl-scroll { overflow-x:auto; }
.tl-head { display:flex; position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid #E3E7ED; }
.tl-corner { width:220px; flex:0 0 220px; padding:10px 14px; font-size:11px; font-weight:600; color:#8A94A6; text-transform:uppercase; position:sticky; left:0; background:#fff; z-index:6; border-right:1px solid #E3E7ED; }
.tl-day { flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 0; border-right:1px solid #F0F2F5; }
.tl-day .wd { font-size:10px; color:#8A94A6; }
.tl-day .md { font-size:12px; font-weight:600; }
.tl-day.wknd { background:#FBF7F2; }
.tl-day.today { background:#FEF3E2; }
.tl-day.today .md { color:#B45309; }
.tl-row { display:flex; border-bottom:1px solid #F0F2F5; }
.tl-name { width:220px; flex:0 0 220px; padding:0 14px; display:flex; align-items:center; justify-content:space-between; gap:8px; position:sticky; left:0; background:#fff; z-index:2; border-right:1px solid #E3E7ED; }
.tl-name .nm { font-size:12.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cnt-badge { font-size:11px; color:#475467; background:#EEF1F5; border-radius:6px; padding:1px 7px; flex-shrink:0; }
.tl-lane { position:relative; display:flex; }
.cell { flex-shrink:0; height:100%; border-right:1px solid #F4F6F8; }
.cell.wknd { background:#FBFAF7; }
.bar { position:absolute; border-radius:7px; border:1.5px solid transparent; display:flex; align-items:center; padding:0 8px; cursor:pointer; overflow:hidden; transition:transform .08s, box-shadow .08s; }
.bar:hover { transform:translateY(-1px); box-shadow:0 3px 8px rgba(0,0,0,.18); z-index:3; }
.bar-lbl { font-size:11px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bar.block { background:repeating-linear-gradient(45deg,rgba(120,130,145,.10),rgba(120,130,145,.10) 4px,transparent 4px,transparent 8px)!important; border-style:dashed!important; }
.tl-nowline { position:absolute; top:0; bottom:0; width:2px; background:#F59E0B; z-index:4; }
.needdot { width:7px; height:7px; border-radius:50%; background:#F59E0B; flex:0 0 auto; margin-right:5px; box-shadow:0 0 0 1.5px rgba(255,255,255,.85); }
.lst .ok { color:#2F7D4E; }
.lst .need { color:#B45309; font-weight:700; }
.m-info { margin-top:18px; display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; border-radius:10px; padding:10px 12px; }
.m-info.todo { background:#FEF3E2; border:1px solid #F5D9A8; color:#8A5A00; }
.m-info.done { background:#EAF6EE; border:1px solid #C5E6D0; color:#2F7D4E; }
.m-info button { border:1px solid rgba(0,0,0,.12); background:#fff; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer; font-family:inherit; white-space:nowrap; }
.lst-wrap { background:#fff; border:1px solid #E3E7ED; border-radius:12px; overflow:auto; }
.lst { width:100%; border-collapse:collapse; font-size:13px; }
.lst th { text-align:left; padding:11px 14px; font-size:11px; text-transform:uppercase; color:#8A94A6; border-bottom:1px solid #E3E7ED; cursor:pointer; white-space:nowrap; position:sticky; top:0; background:#fff; }
.lst th.srt { color:#10151D; }
.lst td { padding:10px 14px; border-bottom:1px solid #F1F3F6; white-space:nowrap; }
.lst tr { cursor:pointer; }
.lst tbody tr:hover { background:#F7F9FB; }
.lst tr.blk td { opacity:.5; }
.lst .strong { font-weight:600; }
.lst .muted { color:#98A2B3; }
.tag { color:#fff; font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; }
.ov { position:fixed; inset:0; background:rgba(16,21,29,.45); display:grid; place-items:center; padding:20px; z-index:50; }
.modal { background:#fff; width:100%; max-width:440px; border-radius:16px; padding:22px 24px 24px; box-shadow:0 20px 60px rgba(0,0,0,.3); }
.m-top { display:flex; align-items:center; gap:10px; padding-bottom:14px; border-bottom:2px solid; margin-bottom:14px; }
.x { margin-left:auto; border:0; background:#F0F2F5; width:28px; height:28px; border-radius:8px; cursor:pointer; }
.modal h2 { font-size:20px; }
.m-prop { font-size:13px; color:#667085; margin:4px 0 16px; }
.m-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 20px; margin:0; }
.m-grid dt { font-size:10.5px; text-transform:uppercase; color:#8A94A6; margin-bottom:3px; }
.m-grid dd { margin:0; font-size:14px; font-weight:500; }
.m-link { display:inline-block; margin-top:18px; margin-right:10px; font-size:13px; font-weight:600; color:#0A3D91; text-decoration:none; border:1px solid #C9D6EE; border-radius:9px; padding:9px 14px; }
.m-toggle { margin-top:18px; font-size:12.5px; color:#5A6472; background:#F3F5F8; border:1px solid #E3E7ED; border-radius:9px; padding:9px 14px; cursor:pointer; font-family:inherit; }
@media (max-width:820px){ .body { flex-direction:column; } .side { width:100%; flex:none; min-height:0; border-right:0; border-bottom:1px solid #E3E7ED; } }
`;
