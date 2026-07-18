"use client";
import "./globals.css";
import { useEffect, useMemo, useRef, useState } from "react";

const DAY_MS = 86400000;
const DAY_W = 46;
const ROW_H = 46;
const PLATFORMS = {
  airbnb: { label: "Airbnb", bar: "#FF5A5F", ink: "#B4272B" },
  booking: { label: "Booking", bar: "#0A3D91", ink: "#0A3D91" },
};
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const CLEANK = {
  inhouse: { label: "自社", color: "#0F766E" },
  outsourced: { label: "外注", color: "#7C3AED" },
};
const TAG_COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6", "#6B7280"];

const parseDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);
const fmtMD = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uid = () => Math.random().toString(36).slice(2, 9);
const readRole = () => { try { const m = document.cookie.match(/(?:^|; )rb_role=([^;]+)/); return m ? decodeURIComponent(m[1]) : "admin"; } catch { return "admin"; } };
const mapRows = (rows) => rows.map((x, i) => ({
  ...x, id: i,
  info_submitted: !!x.info_submitted,
  cleaning_status: x.cleaning_status || "unrequested",
  cleaning_memo: x.cleaning_memo || "",
  ci: parseDate(x.check_in), co: parseDate(x.check_out),
}));

// 各自ブラウザ保存（端末ごとの個人設定）
const LS = {
  get(k, def) { try { const v = localStorage.getItem("mb_" + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem("mb_" + k, JSON.stringify(v)); } catch {} },
};

export default function Dashboard() {
  const [today] = useState(() => startOfDay(new Date()));
  const [role, setRole] = useState("admin");
  useEffect(() => { const m = document.cookie.match(/(?:^|; )rb_role=([^;]+)/); if (m) setRole(decodeURIComponent(m[1])); }, []);
  const isAdmin = role === "admin";
  const isViewer = role === "viewer";
  const canEdit = role === "admin" || role === "staff";
  const [propModal, setPropModal] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState("timeline");
  const [plat, setPlat] = useState({ airbnb: true, booking: true });
  const [showBlocks, setShowBlocks] = useState(true);
  const [needInfoOnly, setNeedInfoOnly] = useState(false);
  const [alertOnly, setAlertOnly] = useState(false);
  const [showCleanLabel, setShowCleanLabel] = useState(false);
  const [cleanings, setCleanings] = useState([]);
  const [cleanSel, setCleanSel] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [sort, setSort] = useState({ key: "check_in", dir: 1 });
  const [syncing, setSyncing] = useState(false);
  const [winStart, setWinStart] = useState(() => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
    return d;
  });

  // 共有設定（サーバー保存）：タグ・割当（複数）・並び順・グループ化
  const [order, setOrder] = useState([]);
  const [tags, setTags] = useState([]);
  const [propTags, setPropTags] = useState({}); // { 物件名: [tagId, ...] }
  const [groupByTag, setGroupByTag] = useState(false);
  const [tagModal, setTagModal] = useState(false);
  const settingsReady = useRef(false);

  // propTags を必ず配列形に正規化（旧: 単一id文字列 → 配列）
  const normPropTags = (pt) => {
    const out = {};
    Object.entries(pt || {}).forEach(([k, v]) => {
      if (Array.isArray(v)) out[k] = v.filter(Boolean);
      else if (v) out[k] = [v];
    });
    return out;
  };

  useEffect(() => {
    // 表示系のローカル設定
    setShowCleanLabel(LS.get("showCleanLabel", false));
    (async () => {
      let s = {};
      try { const r = await fetch("/api/settings"); if (r.ok) s = (await r.json()).settings || {}; } catch {}
      const empty = !s || (!s.tags && !s.order && !s.propTags);
      if (empty && readRole() === "admin") {
        // 旧: このブラウザのlocalStorage設定を引き継ぐ（消さない・管理者のみ）
        const migrated = {
          tags: LS.get("tags", []),
          propTags: normPropTags(LS.get("propTags", {})),
          order: LS.get("order", []),
          groupByTag: LS.get("groupByTag", false),
        };
        setTags(migrated.tags); setPropTags(migrated.propTags);
        setOrder(migrated.order); setGroupByTag(migrated.groupByTag);
        settingsReady.current = true;
        if (migrated.tags.length || migrated.order.length) persist(migrated);
      } else {
        setTags(s.tags || []); setPropTags(normPropTags(s.propTags));
        setOrder(s.order || []); setGroupByTag(!!s.groupByTag);
        settingsReady.current = true;
      }
    })();
  }, []);

  function persist(next) {
    if (readRole() !== "admin") return;
    const payload = {
      tags: next.tags ?? tags,
      propTags: next.propTags ?? propTags,
      order: next.order ?? order,
      groupByTag: next.groupByTag ?? groupByTag,
    };
    fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }
  const saveOrder = (v) => { setOrder(v); persist({ order: v }); };
  const saveTags = (v) => { setTags(v); persist({ tags: v }); };
  const savePropTags = (v) => { setPropTags(v); persist({ propTags: v }); };
  const toggleGroup = () => { const v = !groupByTag; setGroupByTag(v); persist({ groupByTag: v }); };
  const toggleCleanLabel = () => { const v = !showCleanLabel; setShowCleanLabel(v); LS.set("showCleanLabel", v); };

  const busy = useRef(false);
  async function load() {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch("/api/reservations");
          if (r.status === 401) { window.location.href = "/login"; return; }
          if (!r.ok) throw new Error(String(r.status));
          const j = await r.json();
          const rows = j.reservations || [];
          setData(mapRows(rows));
          try { localStorage.setItem("mb_resv_cache", JSON.stringify(rows)); } catch {}
          return;
        } catch (e) {
          if (attempt === 0) await new Promise((res) => setTimeout(res, 1500));
        }
      }
    } finally { busy.current = false; }
  }
  // 直近データを即表示（真っ白な待ちを減らす）→ 裏で最新取得
  useEffect(() => {
    try { const c = localStorage.getItem("mb_resv_cache"); if (c) setData(mapRows(JSON.parse(c))); } catch {}
    load();
    loadCleanings();
  }, []);
  // 自動更新：10分ごと（表示中のみ）＋タブ復帰時
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 600000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, []);
  // スマホ判定（列幅を詰める）
  useEffect(() => {
    const f = () => setIsMobile(window.innerWidth <= 820);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  async function manualSync() {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST" });
    await load();
    setSyncing(false);
  }
  async function toggleCheckin(r) {
    if (!canEdit) return;
    setData((d) => d.map((x) => (x.id === r.id ? { ...x, info_submitted: !x.info_submitted } : x)));
    setSel(null);
    await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: r.property_name, check_in: r.check_in, check_out: r.check_out, submitted: !r.info_submitted }) });
    load();
  }
  async function loadCleanings() {
    try {
      const r = await fetch("/api/cleanings");
      if (r.ok) setCleanings((await r.json()).cleanings || []);
    } catch {}
  }
  async function saveCleaning(sel) {
    if (sel.id) {
      await fetch("/api/cleanings", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.id, kind: sel.kind, memo: sel.memo }) });
    } else {
      await fetch("/api/cleanings", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: sel.property_name, date: sel.date, kind: sel.kind, memo: sel.memo }) });
    }
    setCleanSel(null);
    loadCleanings();
  }
  async function deleteCleaning(id) {
    await fetch("/api/cleanings?id=" + id, { method: "DELETE" });
    setCleanSel(null);
    loadCleanings();
  }
  function toggleTagForProp(name, id) {
    const cur = propTags[name] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const pt = { ...propTags };
    if (next.length) pt[name] = next; else delete pt[name];
    savePropTags(pt);
  }
  async function doRename(from, to) {
    to = (to || "").trim();
    if (!to || to === from) { setPropModal(null); return; }
    await fetch("/api/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
    const npt = { ...propTags };
    if (npt[from]) { npt[to] = Array.from(new Set([...(npt[to] || []), ...npt[from]])); delete npt[from]; }
    const no = order.map((n) => (n === from ? to : n));
    setPropTags(npt); setOrder(no); persist({ propTags: npt, order: no });
    setPropModal(null);
    await fetch("/api/sync", { method: "POST" }); load();
  }
  async function doSplit(r, boundaries) {
    if (!isAdmin) return;
    setSel(null);
    await fetch("/api/split", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: r.property_name, check_in: r.split_ci || r.check_in, check_out: r.split_co || r.check_out, boundaries }) });
    load();
  }
  async function unSplit(r) {
    setSel(null);
    await fetch("/api/split", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: r.property_name, check_in: r.split_ci || r.check_in, check_out: r.split_co || r.check_out, boundaries: null }) });
    load();
  }
  async function toggleType(r) {
    if (!isAdmin) return;
    const next = r.type === "booking" ? "block" : "booking";
    setSel(null);
    await fetch("/api/override", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: r.property_name, check_in: r.check_in, check_out: r.check_out, type: next }) });
    load();
  }

  // 物件一覧（順序・タグ適用）
  const baseProps = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const r of data) if (!m.has(r.property_name)) m.set(r.property_name, r.area || "");
    return [...m.entries()].map(([name, area]) => ({ name, area }));
  }, [data]);

  const viewerHidden = useMemo(() => {
    if (!isViewer) return new Set();
    const noCleanIds = tags.filter((t) => t.name === "清掃不要").map((t) => t.id);
    const hidden = new Set();
    Object.entries(propTags).forEach(([name, arr]) => { if ((arr || []).some((id) => noCleanIds.includes(id))) hidden.add(name); });
    return hidden;
  }, [isViewer, tags, propTags]);

  const props = useMemo(() => {
    let list = baseProps.filter((p) => !viewerHidden.has(p.name));
    // 保存済みの順序を適用（未登録の新物件は末尾）
    const pos = (n) => { const i = order.indexOf(n); return i === -1 ? 1e9 : i; };
    list.sort((a, b) => pos(a.name) - pos(b.name) || a.name.localeCompare(b.name));
    if (groupByTag) {
      const tpos = (n) => { const arr = propTags[n] || []; const i = arr.length ? tags.findIndex((x) => x.id === arr[0]) : -1; return i === -1 ? 1e9 : i; };
      list.sort((a, b) => tpos(a.name) - tpos(b.name) || pos(a.name) - pos(b.name));
    }
    return list;
  }, [baseProps, order, groupByTag, propTags, tags, viewerHidden]);

  const alertLimit = useMemo(() => new Date(today.getTime() + 5 * DAY_MS), [today]);
  const isAlert = (r) => r.type === "booking" && !r.info_submitted && r.ci >= today && r.ci <= alertLimit;

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.filter((r) => {
      if (!plat[r.platform]) return false;
      if (r.type === "block" && !showBlocks) return false;
      if (viewerHidden.has(r.property_name)) return false;
      if (needInfoOnly && (r.type !== "booking" || r.info_submitted)) return false;
      if (alertOnly && !isAlert(r)) return false;
      if (s && !`${r.property_name} ${r.area || ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [data, plat, showBlocks, needInfoOnly, alertOnly, q, today, alertLimit, viewerHidden]);

  const stats = useMemo(() => {
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    let ab = 0, bk = 0, nb = 0, need = 0, alert = 0;
    filtered.forEach((r) => {
      if (r.type !== "booking") return;
      if (r.platform === "airbnb") ab++; else bk++;
      if (!r.info_submitted && r.co >= today) need++;
      if (isAlert(r)) alert++;
      const a = Math.max(r.ci, mStart), b = Math.min(r.co, mEnd);
      if (b > a) nb += Math.round((b - a) / DAY_MS);
    });
    const monStr = isoDate(mStart), monEnd = isoDate(mEnd);
    const cleanCnt = cleanings.filter((c) => c.date >= monStr && c.date < monEnd).length;
    const cap = Math.max(1, props.length) * Math.round((mEnd - mStart) / DAY_MS);
    return { ab, bk, total: ab + bk, occ: Math.round((nb / cap) * 100), need, cleanCnt, alert };
  }, [filtered, props, today, cleanings]);

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

  // ドラッグ並び替え
  const dragName = useRef(null);
  const scrollRef = useRef(null);
  function onDrop(targetName) {
    const from = dragName.current;
    if (!from || from === targetName) return;
    const names = props.map((p) => p.name);
    const fi = names.indexOf(from), ti = names.indexOf(targetName);
    names.splice(ti, 0, names.splice(fi, 1)[0]);
    saveOrder(names);
    dragName.current = null;
  }

  if (!data) return <div style={{ padding: 40, color: "#667085" }}>読み込み中…</div>;
  const tagsOf = (name) => (propTags[name] || []).map((id) => tags.find((t) => t.id === id)).filter(Boolean);
  const dayW = isMobile ? 34 : 46;
  const nameW = isMobile ? 124 : 220;

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="hdr">
        <div className="hdr-left">
          <div className="logo">◲</div>
          <div>
            <h1>予約統合ボード</h1>
            <p className="sub">{props.length} 物件 · {role === "admin" ? "管理者" : role === "staff" ? "運用者" : "閲覧者"}表示{isViewer ? "（見るだけ）" : ""}</p>
          </div>
        </div>
        <div className="chips">
          <Chip color="#DC2626" label="要対応(5日以内 未提出)" value={stats.alert} onClick={() => setAlertOnly((v) => !v)} active={alertOnly} />
          <Chip color="#10151D" label="予約 合計" value={stats.total} />
          <Chip color={PLATFORMS.airbnb.bar} label="Airbnb" value={stats.ab} />
          <Chip color={PLATFORMS.booking.bar} label="Booking" value={stats.bk} />
          <Chip color="#F59E0B" label="事前情報 未提出" value={stats.need} />
          <Chip color="#0F766E" label="今月 清掃予定" value={stats.cleanCnt} />
        </div>
      </header>

      <div className="body">
        <aside className="side">
          {!isViewer && <input className="search" placeholder="物件・エリアを検索" value={q} onChange={(e) => setQ(e.target.value)} />}
          {!isViewer && (
          <FilterGroup title="サイト">
            {Object.entries(PLATFORMS).map(([k, v]) => (
              <label key={k} className="flt">
                <input type="checkbox" checked={plat[k]} onChange={() => setPlat((p) => ({ ...p, [k]: !p[k] }))} />
                <span className="swatch" style={{ background: v.bar }} />{v.label}
              </label>
            ))}
          </FilterGroup>
          )}
          {!isViewer && (
          <FilterGroup title="表示">
            <label className="flt"><input type="checkbox" checked={showBlocks} onChange={() => setShowBlocks((v) => !v)} />ブロックも表示</label>
            <label className="flt"><input type="checkbox" checked={needInfoOnly} onChange={() => setNeedInfoOnly((v) => !v)} />事前情報 未提出のみ</label>
          </FilterGroup>
          )}
          {!isViewer && (
          <FilterGroup title="清掃">
            <label className="flt"><input type="checkbox" checked={showCleanLabel} onChange={toggleCleanLabel} />清掃のメモを表示</label>
            {canEdit && <div className="hint2">空いてる日をクリックで清掃を追加。清掃マーカーをクリックで編集・削除。</div>}
          </FilterGroup>
          )}
          {isAdmin && (
            <FilterGroup title="並び替え・タグ（管理者）">
              <label className="flt"><input type="checkbox" checked={groupByTag} onChange={toggleGroup} />タグごとにまとめる</label>
              <button className="ghost" onClick={() => setTagModal(true)}>タグを作成 / 一括割当</button>
              <div className="hint2">物件名をクリックでタグ付け・名前変更。行の左をドラッグで並び替え（全員に共有）。</div>
            </FilterGroup>
          )}
          {!isViewer && tags.length > 0 && (
            <div className="legend">
              <div className="lg-t">タグ</div>
              {tags.map((t) => <div key={t.id} className="lg-row"><span className="swatch" style={{ background: t.color }} />{t.name}</div>)}
            </div>
          )}
          <div className="legend">
            <div className="lg-row"><span className="swatch" style={{ background: PLATFORMS.airbnb.bar }} />Airbnb 予約</div>
            <div className="lg-row"><span className="swatch" style={{ background: PLATFORMS.booking.bar }} />Booking 予約</div>
            <div className="lg-row"><span className="swatch hatch" />ブロック（件数外）</div>
            <div className="lg-row"><span className="dotm" style={{ background: "#F59E0B" }} />事前情報 未提出</div>
            <div className="lg-row"><span className="clean-legend" style={{ background: "#0F766E" }} />清掃予定（自社）</div>
            <div className="lg-row"><span className="clean-legend" style={{ background: "#7C3AED" }} />清掃予定（外注）</div>
          </div>
          <div className="side-actions">
            {canEdit && <button className="ghost" onClick={manualSync} disabled={syncing}>{syncing ? "同期中…" : "今すぐ同期"}</button>}
            {isAdmin && <a className="ghost" href="/settings">物件・iCal設定</a>}
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
                <button onClick={() => scrollRef.current?.scrollBy({ left: -7 * dayW, behavior: "smooth" })} title="左へ">◀</button>
                <button onClick={() => scrollRef.current?.scrollBy({ left: 7 * dayW, behavior: "smooth" })} title="右へ">▶</button>
                <span className="nav-sep" />
                <button onClick={() => setWinStart(new Date(winStart.getTime() - 7 * DAY_MS))}>‹ 前週</button>
                <button onClick={() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); setWinStart(d); }}>今日</button>
                <button onClick={() => setWinStart(new Date(winStart.getTime() + 7 * DAY_MS))}>次週 ›</button>
              </div>
            )}
            <div className="count mono">予約 {filtered.filter((r) => r.type === "booking").length} 件</div>
          </div>

          {props.length === 0 ? (
            <div className="empty">まだ予約がありません。「物件・iCal設定」でURLを登録し「今すぐ同期」を押してください。</div>
          ) : view === "timeline" ? (
            <Timeline days={days} props={props} rows={filtered} today={today} onSel={isViewer ? null : setSel}
              tagsOf={tagsOf} dragName={dragName} onDrop={onDrop} canDrag={isAdmin && !groupByTag} showCleanLabel={showCleanLabel} dayW={dayW} nameW={nameW} scrollRef={scrollRef}
              cleanings={cleanings} canClean={canEdit}
              onAddCleaning={canEdit ? ((pn, date) => setCleanSel({ property_name: pn, date, kind: "inhouse", memo: "" })) : null}
              onEditCleaning={canEdit ? ((c) => setCleanSel({ ...c })) : null}
              onNameClick={isAdmin ? ((p) => setPropModal({ name: p.name, area: p.area })) : null} />
          ) : (
            <ListView rows={listRows} sort={sort} onSort={toggleSort} onSel={isViewer ? null : setSel} />
          )}
        </main>
      </div>

      {sel && <Detail r={sel} onClose={() => setSel(null)} onToggle={toggleType} onCheckin={toggleCheckin} onSplit={doSplit} onUnsplit={unSplit} canEdit={canEdit} isAdmin={isAdmin} />}
      {cleanSel && canEdit && <CleaningModal sel={cleanSel} onChange={setCleanSel} onSave={saveCleaning} onDelete={deleteCleaning} onClose={() => setCleanSel(null)} />}
      {propModal && isAdmin && <PropertyModal p={propModal} tags={tags} propTags={propTags} onToggle={toggleTagForProp} onRename={doRename} onOpenTagModal={() => { setPropModal(null); setTagModal(true); }} onClose={() => setPropModal(null)} />}
      {tagModal && isAdmin && <TagModal tags={tags} propTags={propTags} props={baseProps} onClose={() => setTagModal(false)}
        saveTags={saveTags} savePropTags={savePropTags} />}
    </div>
  );
}

function Timeline({ days, props, rows, today, onSel, tagsOf, dragName, onDrop, canDrag, showCleanLabel, dayW, nameW, scrollRef, cleanings, canClean, onAddCleaning, onEditCleaning, onNameClick }) {
  const gridW = days.length * dayW;
  const todayIdx = dayDiff(today, days[0]);
  const cleanByProp = {};
  (cleanings || []).forEach((c) => { (cleanByProp[c.property_name] ||= []).push(c); });
  // 月の区切り
  const months = [];
  days.forEach((d) => {
    const key = d.getFullYear() + "-" + d.getMonth();
    const last = months[months.length - 1];
    if (last && last.key === key) last.count++;
    else months.push({ key, count: 1, y: d.getFullYear(), m: d.getMonth() + 1 });
  });
  return (
    <div className="tl-wrap">
      <div className="tl-scroll" ref={scrollRef}>
        <div style={{ minWidth: nameW + gridW }}>
          <div className="tl-head">
            <div className="tl-corner" style={{ width: nameW, flex: `0 0 ${nameW}px` }}>物件</div>
            <div style={{ width: gridW }}>
              <div className="tl-months">
                {months.map((mo, i) => (
                  <div key={i} className="tl-mseg" style={{ width: mo.count * dayW }}>
                    {i === 0 || mo.m === 1 ? `${mo.y}年${mo.m}月` : `${mo.m}月`}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex" }}>
                {days.map((d, i) => {
                  const wknd = d.getDay() === 0 || d.getDay() === 6;
                  const isToday = dayDiff(d, today) === 0;
                  return (
                    <div key={i} className={"tl-day" + (wknd ? " wknd" : "") + (isToday ? " today" : "")} style={{ width: dayW }}>
                      <span className="wd">{WD[d.getDay()]}</span><span className="md mono">{d.getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            {todayIdx >= 0 && todayIdx < days.length && (
              <div className="tl-nowline" style={{ left: nameW + todayIdx * dayW + dayW / 2 }} />
            )}
            {props.map((p) => {
              const rs = rows.filter((r) => r.property_name === p.name);
              const cnt = rs.filter((r) => r.type === "booking").length;
              const ptags = tagsOf(p.name);
              return (
                <div key={p.name} className="tl-row" style={{ height: ROW_H }}>
                  <div className="tl-name" style={{ borderLeft: ptags[0] ? `4px solid ${ptags[0].color}` : "4px solid transparent", width: nameW, flex: `0 0 ${nameW}px` }}
                    draggable={canDrag}
                    onDragStart={() => { dragName.current = p.name; }}
                    onDragOver={(e) => canDrag && e.preventDefault()}
                    onDrop={() => onDrop(p.name)}>
                    {canDrag && <span className="grip">⋮⋮</span>}
                    <div className={"nm-wrap" + (onNameClick ? " clickable-nm" : "")} onClick={() => onNameClick && onNameClick(p)}>
                      <span className="nm">{p.name}</span>
                      {ptags.length > 0 && (
                        <span className="tagchips">
                          {ptags.map((t) => <span key={t.id} className="tagchip" style={{ background: t.color }}>{t.name}</span>)}
                        </span>
                      )}
                    </div>
                    <span className="cnt-badge mono">{cnt}件</span>
                  </div>
                  <div className="tl-lane" style={{ width: gridW }}>
                    {days.map((d, i) => {
                      const wknd = d.getDay() === 0 || d.getDay() === 6;
                      return <div key={i} className={"cell" + (wknd ? " wknd" : "") + (onAddCleaning ? " addable" : "")} style={{ width: dayW }}
                        onClick={onAddCleaning ? (() => onAddCleaning(p.name, isoDate(d))) : undefined}
                        title={onAddCleaning ? `${fmtMD(d)} に清掃を追加` : undefined} />;
                    })}
                    {rs.map((r) => {
                      const off = dayDiff(r.ci, days[0]);
                      if (off + r.nights <= 0 || off >= days.length) return null;
                      const left = off * dayW + dayW / 2 + 3;
                      const width = r.nights * dayW - 6;
                      const pf = PLATFORMS[r.platform] || PLATFORMS.airbnb;
                      const block = r.type === "block";
                      return (
                        <button key={r.id} className={"bar" + (block ? " block" : "")}
                          style={{ left, width, top: 6, height: ROW_H - 20, background: block ? "transparent" : pf.bar, borderColor: block ? "#B6BECB" : pf.bar, cursor: onSel ? "pointer" : "default" }}
                          onClick={() => onSel && onSel(r)}
                          title={`${p.name} ${fmtMD(r.ci)}〜${fmtMD(r.co)}（${r.nights}泊）`}>
                          {!block && !r.info_submitted && <span className="dotm" style={{ background: "#F59E0B" }} />}
                          <span className="bar-lbl" style={{ color: block ? "#5A6472" : "#fff" }}>{block ? "ブロック" : r.nights + "泊"}</span>
                        </button>
                      );
                    })}
                    {(cleanByProp[p.name] || []).map((c) => {
                      const cd = parseDate(c.date);
                      const off = dayDiff(cd, days[0]);
                      if (off < 0 || off >= days.length) return null;
                      const ck = CLEANK[c.kind] || CLEANK.inhouse;
                      return (
                        <button key={"c" + c.id} className="cleanmark"
                          style={{ left: off * dayW + 2, width: dayW - 4, background: ck.color, cursor: onEditCleaning ? "pointer" : "default" }}
                          onClick={(e) => { e.stopPropagation(); onEditCleaning && onEditCleaning(c); }}
                          title={`清掃 ${ck.label}${c.memo ? " / " + c.memo : ""}（${fmtMD(cd)}）`}>
                          <span className="cleanmark-lbl">🧹{showCleanLabel ? (c.memo || ck.label) : ""}</span>
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
              <tr key={r.id} className={r.type === "block" ? "blk" : ""} style={{ cursor: onSel ? "pointer" : "default" }} onClick={() => onSel && onSel(r)}>
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

function Detail({ r, onClose, onToggle, onCheckin, onSplit, onUnsplit, canEdit, isAdmin }) {
  const pf = PLATFORMS[r.platform] || PLATFORMS.airbnb;
  const block = r.type === "block";
  const [splitDate, setSplitDate] = useState("");
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
          <>
            <div className={"m-info " + (r.info_submitted ? "done" : "todo")}>
              <span>事前チェックイン情報：<b>{r.info_submitted ? "提出済み" : "未提出"}</b></span>
              {canEdit && <button onClick={() => onCheckin(r)}>{r.info_submitted ? "未提出に戻す" : "提出済みにする"}</button>}
            </div>

            {isAdmin && (!r.split_ci ? (
              <div className="m-split">
                <div className="m-clean-t">分割（複数の宿泊に分ける）</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="m-memo" placeholder="境目の日 例: 2026-07-19（複数はカンマ区切り）"
                    value={splitDate} onChange={(e) => setSplitDate(e.target.value)} />
                  <button className="cbtn" style={{ flex: "0 0 auto", padding: "8px 14px" }}
                    onClick={() => splitDate.trim() && onSplit(r, splitDate.split(",").map((s) => s.trim()).filter(Boolean))}>分割する</button>
                </div>
                <div className="hint2">Bookingが連続予約を1件にまとめた時に使用。境目＝前の予約のチェックアウト日（＝次のチェックイン）。</div>
              </div>
            ) : (
              <div className="m-split">
                <div style={{ fontSize: 12.5, color: "#475467" }}>この宿泊は分割済み（元 {r.split_ci} 〜 {r.split_co}）</div>
                <button className="m-toggle" style={{ marginTop: 10 }} onClick={() => onUnsplit(r)}>分割を解除して1件に戻す</button>
              </div>
            ))}

            {r.res_url && <a className="m-link" href={r.res_url} target="_blank" rel="noreferrer">予約ページを開く ↗</a>}
            {!r.res_url && r.platform === "booking" && <a className="m-link" href="https://admin.booking.com" target="_blank" rel="noreferrer">Bookingエクストラネットを開く ↗</a>}
          </>
        )}
        {isAdmin && <button className="m-toggle" onClick={() => onToggle(r)}>{block ? "「予約」に戻す" : "「ブロック」に訂正する"}</button>}
      </div>
    </div>
  );
}

function TagModal({ tags, propTags, props, onClose, saveTags, savePropTags }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const addTag = () => { if (!name.trim()) return; saveTags([...tags, { id: uid(), name: name.trim(), color }]); setName(""); };
  const delTag = (id) => {
    saveTags(tags.filter((t) => t.id !== id));
    const pt = {}; Object.entries(propTags).forEach(([k, arr]) => { const f = (arr || []).filter((x) => x !== id); if (f.length) pt[k] = f; }); savePropTags(pt);
  };
  const toggleAssign = (prop, id) => {
    const cur = propTags[prop] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const pt = { ...propTags };
    if (next.length) pt[prop] = next; else delete pt[prop];
    savePropTags(pt);
  };
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-top" style={{ borderColor: "#10151D" }}>
          <b>タグ設定（全員共通）</b>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="tg-add">
          <input placeholder="タグ名（例: 中央区 / 清掃不要 / 高稼働）" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="tg-colors">
            {TAG_COLORS.map((c) => <span key={c} className={"tg-c" + (color === c ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} />)}
          </div>
          <button className="tg-addbtn" onClick={addTag}>追加</button>
        </div>
        <div className="tg-list">
          {tags.map((t) => (
            <span key={t.id} className="tg-chip" style={{ borderColor: t.color }}>
              <span className="swatch" style={{ background: t.color }} />{t.name}
              <button onClick={() => delTag(t.id)}>×</button>
            </span>
          ))}
          {tags.length === 0 && <span className="muted">まだタグがありません</span>}
        </div>

        <div className="tg-assign-t">物件にタグを割り当て（複数可・クリックでオン/オフ）</div>
        <div className="tg-assign">
          {props.map((p) => (
            <div key={p.name} className="tg-row">
              <span className="tg-pn">{p.name}</span>
              <div className="tg-opts">
                {tags.length === 0 && <span className="muted">先にタグを追加</span>}
                {tags.map((t) => {
                  const on = (propTags[p.name] || []).includes(t.id);
                  return (
                    <button key={t.id} className={"tg-opt" + (on ? " on" : "")}
                      style={on ? { background: t.color, borderColor: t.color, color: "#fff" } : { borderColor: t.color, color: t.color }}
                      onClick={() => toggleAssign(p.name, t.id)}>{t.name}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PropertyModal({ p, tags, propTags, onToggle, onRename, onOpenTagModal, onClose }) {
  const [newName, setNewName] = useState(p.name);
  const cur = propTags[p.name] || [];
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="m-top" style={{ borderColor: "#10151D" }}>
          <b>物件の設定</b><button className="x" onClick={onClose}>✕</button>
        </div>
        <h2 style={{ fontSize: 18 }}>{p.name}</h2>
        <div className="m-prop">{p.area}</div>

        <div className="m-clean-t">タグ（クリックでオン/オフ・複数可）</div>
        <div className="tg-opts" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
          {tags.length === 0 && <span className="muted">タグがありません</span>}
          {tags.map((t) => {
            const on = cur.includes(t.id);
            return <button key={t.id} className="tg-opt" style={on ? { background: t.color, borderColor: t.color, color: "#fff" } : { borderColor: t.color, color: t.color }} onClick={() => onToggle(p.name, t.id)}>{t.name}</button>;
          })}
        </div>
        <button className="ghost" style={{ width: "auto", display: "inline-block", marginBottom: 18 }} onClick={onOpenTagModal}>＋ 新しいタグを作る</button>

        <div className="m-clean-t">物件名を変更</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="m-memo" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="tg-addbtn" onClick={() => onRename(p.name, newName)}>変更</button>
        </div>
        <p className="hint2" style={{ marginTop: 8 }}>Airbnb/Bookingや清掃・分割の紐付けも一緒に変わります。既存名にすると統合。</p>
      </div>
    </div>
  );
}

function CleaningModal({ sel, onChange, onSave, onDelete, onClose }) {
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="m-top" style={{ borderColor: "#0F766E" }}>
          <span className="tag" style={{ background: "#0F766E" }}>清掃</span>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <h2 style={{ fontSize: 18 }}>{sel.property_name}</h2>
        <div className="m-prop">{sel.date}{sel.id ? "" : "（新規）"}</div>
        <div className="m-clean-btns">
          {Object.entries(CLEANK).map(([k, v]) => (
            <button key={k} className="cbtn" style={sel.kind === k ? { background: v.color, borderColor: v.color, color: "#fff" } : {}}
              onClick={() => onChange({ ...sel, kind: k })}>{v.label}</button>
          ))}
        </div>
        <input className="m-memo" style={{ marginTop: 10 }} placeholder="メモ（依頼先など）"
          value={sel.memo} onChange={(e) => onChange({ ...sel, memo: e.target.value })} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="tg-addbtn" style={{ flex: 1 }} onClick={() => onSave(sel)}>保存</button>
          {sel.id && <button className="m-toggle" style={{ marginTop: 0 }} onClick={() => onDelete(sel.id)}>削除</button>}
        </div>
      </div>
    </div>
  );
}

function Chip({ color, label, value, onClick, active }) {
  return <div className={"stat" + (onClick ? " clickable" : "") + (active ? " active" : "")} onClick={onClick}><span className="dot" style={{ background: color }} /><div><div className="stat-v mono">{value}</div><div className="stat-l">{label}</div></div></div>;
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
.stat.clickable { cursor:pointer; }
.stat.clickable:hover { background:#EEF1F5; }
.stat.active { outline:2px solid #DC2626; background:#FEF2F2; }
.tagchips { display:flex; gap:3px; flex-wrap:nowrap; overflow:hidden; }
.tg-opts { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.tg-opt { border:1.5px solid; background:#fff; border-radius:14px; padding:3px 10px; font-size:12px; cursor:pointer; font-family:inherit; }
.body { display:flex; align-items:flex-start; }
.side { width:220px; flex:0 0 220px; padding:18px 16px; border-right:1px solid #E3E7ED; background:#fff; min-height:calc(100vh - 74px); }
.main { flex:1; min-width:0; padding:16px 20px 40px; }
.search { width:100%; padding:9px 11px; border:1px solid #D8DDE5; border-radius:9px; font-size:13px; margin-bottom:18px; outline:none; }
.fg { margin-bottom:18px; }
.fg-t { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:#8A94A6; margin-bottom:9px; }
.flt { display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 0; cursor:pointer; }
.flt input { accent-color:#10151D; }
.swatch { width:13px; height:13px; border-radius:4px; display:inline-block; flex:0 0 auto; }
.swatch.hatch { background:repeating-linear-gradient(45deg,#B6BECB,#B6BECB 3px,#fff 3px,#fff 6px); border:1px solid #C3CAD5; }
.dotm { width:8px; height:8px; border-radius:50%; display:inline-block; flex:0 0 auto; }
.hint2 { font-size:11px; color:#98A2B3; margin-top:6px; line-height:1.5; }
.selc { width:100%; margin-top:8px; padding:8px 9px; border:1px solid #D8DDE5; border-radius:8px; font-size:12.5px; font-family:inherit; background:#fff; }
.legend { border-top:1px solid #EDF0F4; padding-top:14px; margin-bottom:14px; }
.lg-t { font-size:11px; font-weight:600; color:#8A94A6; text-transform:uppercase; margin-bottom:8px; }
.lg-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#475467; padding:3px 0; }
.side-actions { display:flex; flex-direction:column; gap:8px; border-top:1px solid #EDF0F4; padding-top:14px; }
.ghost { text-align:left; border:1px solid #D8DDE5; background:#fff; border-radius:8px; padding:8px 11px; font-size:12.5px; cursor:pointer; font-family:inherit; color:#10151D; text-decoration:none; display:block; width:100%; }
.ghost:hover { background:#F5F7FA; }
.toolbar { display:flex; align-items:center; gap:14px; margin-bottom:14px; flex-wrap:wrap; }
.seg { display:inline-flex; background:#E4E8EE; border-radius:9px; padding:3px; }
.seg button { border:0; background:transparent; padding:7px 15px; font-size:13px; font-weight:600; border-radius:7px; cursor:pointer; color:#5A6472; font-family:inherit; }
.seg button.on { background:#fff; color:#10151D; box-shadow:0 1px 2px rgba(0,0,0,.08); }
.nav { display:flex; gap:6px; align-items:center; }
.nav-sep { width:1px; height:20px; background:#D8DDE5; margin:0 2px; }
.nav button { border:1px solid #D8DDE5; background:#fff; border-radius:8px; padding:6px 11px; font-size:12.5px; cursor:pointer; font-family:inherit; }
.count { margin-left:auto; font-size:12.5px; color:#667085; }
.empty { background:#fff; border:1px dashed #C9D0DA; border-radius:12px; padding:40px 24px; text-align:center; color:#667085; font-size:14px; }
.tl-wrap { background:#fff; border:1px solid #E3E7ED; border-radius:12px; overflow:hidden; }
.tl-scroll { overflow:auto; max-height:calc(100vh - 160px); overscroll-behavior:contain; }
.tl-head { display:flex; position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid #E3E7ED; }
.tl-corner { width:220px; flex:0 0 220px; padding:10px 14px; font-size:11px; font-weight:600; color:#8A94A6; text-transform:uppercase; position:sticky; left:0; background:#fff; z-index:6; border-right:1px solid #E3E7ED; display:flex; align-items:flex-end; }
.tl-months { display:flex; border-bottom:1px solid #EDF0F4; }
.tl-mseg { flex-shrink:0; font-size:11.5px; font-weight:700; color:#344054; padding:4px 0 4px 8px; border-right:1px solid #E3E7ED; white-space:nowrap; background:#FAFBFC; font-family:'Space Grotesk',sans-serif; }
.tl-day { flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 0; border-right:1px solid #F0F2F5; }
.tl-day .wd { font-size:10px; color:#8A94A6; }
.tl-day .md { font-size:12px; font-weight:600; }
.tl-day.wknd { background:#FBF7F2; }
.tl-day.today { background:#FEF3E2; }
.tl-day.today .md { color:#B45309; }
.tl-row { display:flex; border-bottom:1px solid #F0F2F5; }
.tl-name { width:220px; flex:0 0 220px; padding:0 12px; display:flex; align-items:center; gap:6px; position:sticky; left:0; background:#fff; z-index:2; border-right:1px solid #E3E7ED; }
.tl-name .nm { font-size:12.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.nm-wrap { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:2px; overflow:hidden; }
.tagchip { flex:0 0 auto; max-width:100%; font-size:9px; line-height:1.3; font-weight:600; color:#fff; padding:0 5px; border-radius:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grip { color:#C3CAD5; cursor:grab; font-size:11px; letter-spacing:-2px; user-select:none; }
.cnt-badge { font-size:11px; color:#475467; background:#EEF1F5; border-radius:6px; padding:1px 7px; flex-shrink:0; }
.tl-lane { position:relative; display:flex; }
.cell { flex-shrink:0; height:100%; border-right:1px solid #F4F6F8; }
.cell.wknd { background:#FBFAF7; }
.bar { position:absolute; border-radius:7px; border:1.5px solid transparent; display:flex; align-items:center; gap:3px; padding:0 7px; cursor:pointer; overflow:hidden; transition:transform .08s, box-shadow .08s; }
.bar:hover { transform:translateY(-1px); box-shadow:0 3px 8px rgba(0,0,0,.18); z-index:3; }
.bar .dotm { box-shadow:0 0 0 1.5px rgba(255,255,255,.85); }
.bar-lbl { font-size:11px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:4px; min-width:0; }
.inhouse-badge { flex:0 0 auto; background:#fff; color:#10151D; font-size:9px; font-weight:700; line-height:1.4; padding:0 4px; border-radius:3px; }
.clean-memo { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nights { flex:0 0 auto; }
.bar.block { background:repeating-linear-gradient(45deg,rgba(120,130,145,.10),rgba(120,130,145,.10) 4px,transparent 4px,transparent 8px)!important; border-style:dashed!important; }
.tl-nowline { position:absolute; top:0; bottom:0; width:2px; background:#F59E0B; z-index:4; }
.cell { }
.cell.addable { cursor:pointer; }
.cell.addable:hover { background:#EAF6F2; }
.clickable-nm { cursor:pointer; }
.clickable-nm:hover .nm { text-decoration:underline; }
.cleanmark { position:absolute; bottom:3px; height:15px; border-radius:4px; border:0; display:flex; align-items:center; padding:0 3px; cursor:pointer; overflow:hidden; z-index:3; box-shadow:0 0 0 1.5px #fff, 0 1px 2px rgba(0,0,0,.2); }
.cleanmark:hover { filter:brightness(1.1); }
.cleanmark-lbl { font-size:9px; color:#fff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.clean-legend { width:14px; height:9px; border-radius:3px; display:inline-block; flex:0 0 auto; }
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
.lst .ok { color:#2F7D4E; }
.lst .need { color:#B45309; font-weight:700; }
.tag { color:#fff; font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; }
.ov { position:fixed; inset:0; background:rgba(16,21,29,.45); display:grid; place-items:center; padding:20px; z-index:50; }
.modal { background:#fff; width:100%; max-width:460px; border-radius:16px; padding:22px 24px 24px; box-shadow:0 20px 60px rgba(0,0,0,.3); max-height:88vh; overflow:auto; }
.modal.wide { max-width:560px; }
.m-top { display:flex; align-items:center; gap:10px; padding-bottom:14px; border-bottom:2px solid; margin-bottom:14px; }
.x { margin-left:auto; border:0; background:#F0F2F5; width:28px; height:28px; border-radius:8px; cursor:pointer; }
.modal h2 { font-size:20px; }
.m-prop { font-size:13px; color:#667085; margin:4px 0 16px; }
.m-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 20px; margin:0 0 4px; }
.m-grid dt { font-size:10.5px; text-transform:uppercase; color:#8A94A6; margin-bottom:3px; }
.m-grid dd { margin:0; font-size:14px; font-weight:500; }
.m-info { margin-top:16px; display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; border-radius:10px; padding:10px 12px; }
.m-info.todo { background:#FEF3E2; border:1px solid #F5D9A8; color:#8A5A00; }
.m-info.done { background:#EAF6EE; border:1px solid #C5E6D0; color:#2F7D4E; }
.m-info button { border:1px solid rgba(0,0,0,.12); background:#fff; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer; font-family:inherit; white-space:nowrap; }
.m-clean { margin-top:14px; border:1px solid #E3E7ED; border-radius:10px; padding:12px; }
.m-split { margin-top:14px; border:1px solid #E3E7ED; border-radius:10px; padding:12px; }
.m-clean-t { font-size:11px; font-weight:600; color:#8A94A6; text-transform:uppercase; margin-bottom:8px; }
.m-clean-btns { display:flex; gap:8px; margin-bottom:10px; }
.cbtn { flex:1; border:1px solid #D8DDE5; background:#fff; border-radius:8px; padding:8px 6px; font-size:12.5px; cursor:pointer; font-family:inherit; }
.m-memo { width:100%; padding:8px 10px; border:1px solid #D8DDE5; border-radius:8px; font-size:13px; outline:none; font-family:inherit; }
.m-link { display:inline-block; margin-top:16px; margin-right:10px; font-size:13px; font-weight:600; color:#0A3D91; text-decoration:none; border:1px solid #C9D6EE; border-radius:9px; padding:9px 14px; }
.m-toggle { margin-top:16px; font-size:12.5px; color:#5A6472; background:#F3F5F8; border:1px solid #E3E7ED; border-radius:9px; padding:9px 14px; cursor:pointer; font-family:inherit; display:block; }
.tg-add { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
.tg-add input { flex:1; min-width:180px; padding:9px 11px; border:1px solid #D8DDE5; border-radius:8px; font-size:13px; outline:none; font-family:inherit; }
.tg-colors { display:flex; gap:5px; }
.tg-c { width:20px; height:20px; border-radius:6px; cursor:pointer; border:2px solid transparent; }
.tg-c.on { border-color:#10151D; }
.tg-addbtn { border:0; background:#10151D; color:#fff; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; }
.tg-list { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:18px; }
.tg-chip { display:inline-flex; align-items:center; gap:6px; border:1.5px solid; border-radius:20px; padding:4px 10px; font-size:12.5px; }
.tg-chip button { border:0; background:transparent; cursor:pointer; font-size:14px; color:#98A2B3; }
.tg-assign-t { font-size:11px; font-weight:600; color:#8A94A6; text-transform:uppercase; margin-bottom:8px; border-top:1px solid #EDF0F4; padding-top:14px; }
.tg-assign { display:flex; flex-direction:column; gap:6px; max-height:240px; overflow:auto; }
.tg-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.tg-pn { font-size:13px; }
.tg-row select { border:1px solid #D8DDE5; border-radius:8px; padding:6px 8px; font-size:12.5px; font-family:inherit; }
.muted { color:#98A2B3; }
@media (max-width:820px){
  .body { flex-direction:column; }
  .side { width:100%; flex:none; min-height:0; border-right:0; border-bottom:1px solid #E3E7ED; }
  .hdr { padding:12px 14px; gap:12px; }
  .hdr h1 { font-size:17px; }
  .sub { font-size:11px; }
  .stat { padding:6px 10px; border-radius:9px; }
  .stat-v { font-size:14px; }
  .stat-l { font-size:9.5px; }
  .main { padding:12px 12px 30px; }
  .tl-day .wd { font-size:9px; }
  .tl-day .md { font-size:11px; }
  .tl-mseg { font-size:10.5px; padding-left:6px; }
  .tl-name .nm { font-size:11.5px; }
  .tagchip { font-size:8.5px; }
  .cnt-badge { padding:1px 5px; font-size:10px; }
  .bar-lbl { font-size:10px; }
  .grip { display:none; }
  .tl-scroll { max-height:calc(100vh - 210px); }
}
`;
