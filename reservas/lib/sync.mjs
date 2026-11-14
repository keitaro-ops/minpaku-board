import { db } from "./db.mjs";
import { parseICS, mergeFeeds } from "./ical.mjs";
import { ensureColumn, clearStuckParkingDDL } from "./parking.mjs";

// 案A: チェックインが過ぎた予約（check_in < 今日 = 滞在開始済み）はDBに確定保存して残す。
// これから始まる予約（check_in >= 今日）だけ iCal 最新で入れ替える。
// → 滞在に入った予約は iCal から消えても実績として残る（Booking の消失対策）。
// Booking の手動分割(splits)は読み取り時に適用され、確定済みの生データは
// 二度と上書きされないため、分割済みの件数がそのまま固定される。
export async function runSync() {
  const sql = db();
  const feedRows = await sql`select * from feeds where active = true`;

  const feeds = [];
  const errors = [];
  await Promise.all(
    feedRows.map(async (f) => {
      try {
        const res = await fetch(f.ical_url, { headers: { "User-Agent": "minpaku-board/1.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        feeds.push({
          propertyName: f.property_name,
          area: f.area || "",
          platform: f.platform,
          events: parseICS(text),
        });
      } catch (e) {
        errors.push({ feed: f.property_name + "/" + f.platform, error: String(e.message || e) });
      }
    })
  );

  const merged = mergeFeeds(feeds);
  // 「今日」は日本時間(JST)で判定（UTCだと日本の未明に前日扱いになりズレる）
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().slice(0, 10);

  // 今回“取得に成功した”物件だけを入れ替え対象にする。
  // （iCal取得が失敗した物件は触らない＝一時的な取得失敗で予約が消えるのを防ぐ）
  const okProps = [...new Set(feeds.map((f) => f.propertyName))];

  // チェックインが明日以降（> 今日）の分だけ iCal で入れ替える。
  // チェックイン <= 今日（当日イン含む＝滞在開始済み/当日）は確定保持し、上書きしない。
  const upToStr = (r) => r.checkIn.toISOString().slice(0, 10);
  const upcoming = merged.filter((r) => upToStr(r) > today);

  // 直前予約対策：チェックインが「今日以前」でも、DBにまだ無い予約は追加する。
  // （当日・前日に確定してiCalに出た予約は、保持側に回って挿入されず取りこぼしていた）
  // 直近31日分を対象に、既存(物件+IN+OUT)に無いものだけINSERT（既存は消さない＝分割等を保持）。
  const floor = new Date(jstNow.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentCurrent = merged.filter((r) => { const d = upToStr(r); return d <= today && d >= floor; });

  let deleted = 0, addedLate = 0;
  await sql.begin(async (tx) => {
    if (okProps.length) {
      // 取得成功した物件の「明日以降」分だけ削除 → 入れ替え。
      const res = await tx`delete from reservations where check_in > ${today}::date and property_name in ${tx(okProps)}`;
      deleted = res.count || 0;
    }
    if (upcoming.length) {
      const payload = upcoming.map((r) => ({
        property_name: r.propertyName,
        area: r.area || "",
        platform: r.platform,
        type: r.type,
        check_in: r.checkIn.toISOString().slice(0, 10),
        check_out: r.checkOut.toISOString().slice(0, 10),
        nights: r.nights,
        res_code: r.resCode || null,
        res_url: r.resUrl || null,
        summary: r.summary || null,
      }));
      await tx`insert into reservations ${tx(payload)}`;
    }
    // 直前予約の取りこぼしを補完（既存に無いものだけ追加）
    if (recentCurrent.length && okProps.length) {
      const existing = await tx`
        select property_name, to_char(check_in,'YYYY-MM-DD') as ci, to_char(check_out,'YYYY-MM-DD') as co
        from reservations
        where check_in <= ${today}::date and check_in >= ${floor}::date and property_name in ${tx(okProps)}`;
      const seen = new Set(existing.map((x) => `${x.property_name}|${x.ci}|${x.co}`));
      const toAdd = recentCurrent.filter((r) => !seen.has(`${r.propertyName}|${r.checkIn.toISOString().slice(0,10)}|${r.checkOut.toISOString().slice(0,10)}`));
      if (toAdd.length) {
        const payload2 = toAdd.map((r) => ({
          property_name: r.propertyName, area: r.area || "", platform: r.platform, type: r.type,
          check_in: r.checkIn.toISOString().slice(0, 10), check_out: r.checkOut.toISOString().slice(0, 10),
          nights: r.nights, res_code: r.resCode || null, res_url: r.resUrl || null, summary: r.summary || null,
        }));
        await tx`insert into reservations ${tx(payload2)}`;
        addedLate = toAdd.length;
      }
    }
  });

  // キャンセル等で予約が消えた🚗を外す。
  // iCalの一時的な欠落で消さないよう、「予約が見えない状態が1時間以上続いた」ものだけ削除する。
  let parkingRemoved = 0;
  if (okProps.length) {
    try {
      await clearStuckParkingDDL(sql);
      await ensureColumn(sql, "parking_status", "orphan_since", "timestamptz");
      const live = () => sql`exists (select 1 from reservations r where r.property_name = p.property_name
                         and r.check_in = p.check_in and r.check_out = p.check_out and r.type = 'booking')`;
      // 予約が戻ってきたものは猶予をリセット
      await sql`update parking_status p set orphan_since = null where orphan_since is not null and ${live()}`;
      // 新たに予約が見えなくなったもの（これから始まる予約のみ）に猶予開始を記録
      await sql`update parking_status p set orphan_since = now()
                where p.parking and p.orphan_since is null and p.check_in > ${today}::date
                  and p.property_name in ${sql(okProps)} and not ${live()}`;
      const del = await sql`delete from parking_status p
                where p.orphan_since < now() - interval '1 hour'
                  and p.property_name in ${sql(okProps)} and not ${live()}`;
      parkingRemoved = del.count || 0;
    } catch (e) { errors.push({ feed: "parking_cleanup", error: String(e.message || e) }); }
  }

  // ダブルブッキングの可能性を検知し、新規のみ Google Chat へ通知
  let conflictsNew = 0;
  try { conflictsNew = await detectAndAlertConflicts(sql, today); }
  catch (e) { errors.push({ feed: "conflict_detect", error: String(e.message || e) }); }

  // 同期ログ（異常な大量削除に後から気づけるよう記録）
  try {
    await sql`insert into sync_log (ran_at, deleted, inserted, feeds_ok, feeds_error)
              values (now(), ${deleted}, ${upcoming.length + addedLate}, ${feeds.length}, ${errors.length})`;
  } catch {}

  const [{ count }] = await sql`select count(*)::int as count from reservations`;
  return { feeds: feedRows.length, reservations: count, updatedUpcoming: upcoming.length, parkingRemoved, conflictsNew, errors };
}

// ── ダブルブッキング検知（同一物件・両方とも予約(booking)・宿泊夜が重なる）──────────
// 連動が効いている「予約＋ブロック」や完全同一日程の鏡は mergeFeeds で1件に畳まれるため誤検知しない。
// 新規に見つかった時だけ Chat 通知（毎回の同期で鳴らさない）。重なりが解消したら resolved にし、再発時は再通知。
const _fmtMD = (s) => { const [, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}`; };
const _platName = (x) => (x === "airbnb" ? "Airbnb" : x === "booking" ? "Booking.com" : x || "?");

async function detectAndAlertConflicts(sql, today) {
  await sql`
    create table if not exists booking_conflicts (
      conflict_key text primary key,
      property_name text not null,
      detail text not null default '',
      detected_at timestamptz not null default now(),
      notified_chat boolean not null default false,
      resolved boolean not null default false,
      resolved_at timestamptz
    )`;

  // 同一物件・両方 booking・夜が重なる（CO=IN は重ならない）・重なりが今日以降
  const pairs = await sql`
    select a.property_name,
           a.platform as a_plat, to_char(a.check_in,'YYYY-MM-DD') as a_ci, to_char(a.check_out,'YYYY-MM-DD') as a_co,
           b.platform as b_plat, to_char(b.check_in,'YYYY-MM-DD') as b_ci, to_char(b.check_out,'YYYY-MM-DD') as b_co,
           to_char(greatest(a.check_in,b.check_in),'YYYY-MM-DD') as ov_ci,
           to_char(least(a.check_out,b.check_out),'YYYY-MM-DD') as ov_co
    from reservations a
    join reservations b
      on a.property_name = b.property_name and a.id < b.id
    where a.type = 'booking' and b.type = 'booking'
      and a.check_in < b.check_out and b.check_in < a.check_out
      and least(a.check_out, b.check_out) > ${today}::date`;

  // 行idに依存しない正規キー（2辺を文字列ソート）
  const keyOf = (p) => {
    const A = `${p.a_plat}:${p.a_ci}:${p.a_co}`, B = `${p.b_plat}:${p.b_ci}:${p.b_co}`;
    const [x, y] = [A, B].sort();
    return `${p.property_name}||${x}||${y}`;
  };
  const current = new Map();
  for (const p of pairs) current.set(keyOf(p), p);

  // 解消したものは resolved（再発時に再通知できるように）
  const openRows = await sql`select conflict_key from booking_conflicts where resolved = false`;
  for (const r of openRows) {
    if (!current.has(r.conflict_key))
      await sql`update booking_conflicts set resolved = true, resolved_at = now() where conflict_key = ${r.conflict_key}`;
  }

  // 新規（未登録 or 以前 resolved）だけ通知
  let newCount = 0;
  for (const [k, p] of current) {
    const [row] = await sql`select resolved from booking_conflicts where conflict_key = ${k}`;
    const isNew = !row || row.resolved === true;
    if (!isNew) continue;
    const detail = JSON.stringify({ a: { platform: p.a_plat, ci: p.a_ci, co: p.a_co },
                                    b: { platform: p.b_plat, ci: p.b_ci, co: p.b_co },
                                    overlap: { ci: p.ov_ci, co: p.ov_co } });
    await sql`
      insert into booking_conflicts (conflict_key, property_name, detail, detected_at, notified_chat, resolved, resolved_at)
      values (${k}, ${p.property_name}, ${detail}, now(), false, false, null)
      on conflict (conflict_key) do update set resolved = false, resolved_at = null, detected_at = now(), detail = excluded.detail, notified_chat = false`;
    newCount++;
    await alertConflictChat(sql, p);
    await sql`update booking_conflicts set notified_chat = true where conflict_key = ${k}`;
  }
  return newCount;
}

async function alertConflictChat(sql, p) {
  const text =
    `⚠️ 【ダブルブッキングの可能性】${p.property_name}\n` +
    `A: ${_platName(p.a_plat)}  ${_fmtMD(p.a_ci)}〜${_fmtMD(p.a_co)}\n` +
    `B: ${_platName(p.b_plat)}  ${_fmtMD(p.b_ci)}〜${_fmtMD(p.b_co)}\n` +
    `重なり: ${_fmtMD(p.ov_ci)}〜${_fmtMD(p.ov_co)}\n` +
    `※ Airbnb と Booking の連動・在庫設定をご確認ください。`;
  const urls = [];
  try {
    const [hook] = await sql`select webhook_url from chat_webhooks where property_name = ${p.property_name}`;
    if (hook?.webhook_url) urls.push(hook.webhook_url);
  } catch {}
  if (process.env.OPS_CHAT_WEBHOOK) urls.push(process.env.OPS_CHAT_WEBHOOK);
  for (const u of urls) {
    try {
      await fetch(u, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ text }) });
    } catch {}
  }
}
