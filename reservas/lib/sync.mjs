import { db } from "./db.mjs";
import { parseICS, mergeFeeds } from "./ical.mjs";
import { ensureColumn, clearStuckParkingDDL } from "./parking.mjs";
import { ensureConflictTable, recordConflict, detectEmailConflicts, flushPendingAlerts } from "./conflict.mjs";

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
    // 直前（直近31日の過去）予約の反映：従来の「無いものだけ追加」から「置換」に変更し、
    // 延長・変更で旧版が残り重なっていく蓄積を防ぐ。※未来予約の削除ロジックには触れない。
    //  - 予約(booking): 同一(物件・チェックイン・サイト)の過去版を消して現版に更新
    //  - Airbnbのブロック: 同一物件で重なる過去ブロックを消して現版に（シフトした予約不可枠の蓄積を防ぐ）
    //  - Bookingのブロック(長期): 保守的に、未存在のときだけ追加（実予約の可能性があるため消さない）
    if (recentCurrent.length && okProps.length) {
      const existing = await tx`
        select property_name, to_char(check_in,'YYYY-MM-DD') as ci, to_char(check_out,'YYYY-MM-DD') as co
        from reservations
        where check_in <= ${today}::date and check_in >= ${floor}::date and property_name in ${tx(okProps)}`;
      const seen = new Set(existing.map((x) => `${x.property_name}|${x.ci}|${x.co}`));
      for (const r of recentCurrent) {
        const ci = r.checkIn.toISOString().slice(0, 10);
        const co = r.checkOut.toISOString().slice(0, 10);
        if (r.type === "block") {
          if (r.platform === "airbnb") {
            await tx`delete from reservations where property_name = ${r.propertyName}
                     and type = 'block' and platform = 'airbnb'
                     and check_in <= ${today}::date and check_in < ${co}::date and check_out > ${ci}::date`;
          } else if (seen.has(`${r.propertyName}|${ci}|${co}`)) {
            continue;   // Bookingの長期ブロックは既存があれば触らない
          }
        } else {
          await tx`delete from reservations where property_name = ${r.propertyName}
                   and platform = ${r.platform} and type = 'booking'
                   and check_in = ${ci}::date and check_in <= ${today}::date`;
        }
        await tx`insert into reservations ${tx([{
          property_name: r.propertyName, area: r.area || "", platform: r.platform, type: r.type,
          check_in: ci, check_out: co, nights: r.nights,
          res_code: r.resCode || null, res_url: r.resUrl || null, summary: r.summary || null,
        }])}`;
        addedLate++;
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
  try { conflictsNew = await runConflictDetection(sql, today); }
  catch (e) { errors.push({ feed: "conflict_detect", error: String(e.message || e) }); }

  // 同期ログ（異常な大量削除に後から気づけるよう記録）
  try {
    await sql`insert into sync_log (ran_at, deleted, inserted, feeds_ok, feeds_error)
              values (now(), ${deleted}, ${upcoming.length + addedLate}, ${feeds.length}, ${errors.length})`;
  } catch {}

  const [{ count }] = await sql`select count(*)::int as count from reservations`;
  return { feeds: feedRows.length, reservations: count, updatedUpcoming: upcoming.length, parkingRemoved, conflictsNew, errors };
}

// ── ダブルブッキング検知（iCal検知 ＋ メール照合）───────────────────────────────
// iCal: 同一物件・両方とも予約(booking)・夜が重なるペア。連動の「予約＋ブロック」や
//       完全同一日程の鏡は mergeFeeds で1件に畳まれるため、iCal単体では拾えない/誤検知しない。
// メール照合: Bookingの予約メール(email_bookings)で「本物の予約」と確定した日程を iCal の
//       該当予約から特定し、同じ物件の Airbnb 予約と重なれば衝突（完全同一日程もここで検知）。
// 新規に見つかった時だけ Chat 通知。重なりが解消したら resolved、再発で再通知。両検知は同一キーで重複排除。
async function runConflictDetection(sql, today) {
  await ensureConflictTable(sql);
  const current = new Set();
  let alerted = 0;

  // 1) iCal 検知（Airbnb↔Booking のクロスのみ・夜が重なる・重なりが今日以降）
  //    同一サイト同士(booking×booking 等)の重なりは、日程変更やキャンセルで残った
  //    古い行による“幽霊”がほとんど。連動対象は Airbnb↔Booking なので cross のみ検知する。
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
      and a.platform <> b.platform
      and a.check_in < b.check_out and b.check_in < a.check_out
      and least(a.check_out, b.check_out) > ${today}::date`;
  for (const p of pairs) {
    const r = await recordConflict(sql, {
      property_name: p.property_name,
      A: { platform: p.a_plat, ci: p.a_ci, co: p.a_co },
      B: { platform: p.b_plat, ci: p.b_ci, co: p.b_co },
      overlap: { ci: p.ov_ci, co: p.ov_co },
    });
    current.add(r.key);
  }

  // 2) メール照合検知（Booking予約メール × Airbnb予約）
  const emailConf = await detectEmailConflicts(sql, today);
  for (const c of emailConf) {
    const r = await recordConflict(sql, c);
    current.add(r.key);
  }

  // 3) どちらの検知にも出てこなくなったものは resolved（再発時に再通知できるように）
  const open = await sql`select conflict_key from booking_conflicts where resolved = false`;
  for (const o of open) {
    if (!current.has(o.conflict_key))
      await sql`update booking_conflicts set resolved = true, resolved_at = now() where conflict_key = ${o.conflict_key}`;
  }

  // 4) 通知可能時間帯(JST 9:00–20:00)に、未通知の“現在も有効な”衝突だけ送信。
  //    20時以降に出たものは保留され、翌9時以降の実行で送られる（夜間に自己解決したものは送らない）。
  alerted = await flushPendingAlerts(sql, current);
  return alerted;
}
