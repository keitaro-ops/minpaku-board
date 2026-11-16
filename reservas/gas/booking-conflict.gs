/**
 * Booking.com の「新規予約／キャンセル」メールを解析して /api/inbound に送る。
 * → ボード側で、Airbnb予約との “完全同一日程を含む” ダブルブッキングを検知し、
 *    その物件の Google Chat へ「ダブルブッキングの可能性」を通知します。
 *
 * 背景: iCal の Booking は予約もブロックも "CLOSED" で届き区別できないため、完全同一日程の
 *       二重予約は iCal だけでは拾えません。予約メール＝「本物の予約」の確証なので、これを併用します。
 *
 * 設置: 既存の runInbound と同じ Apps Script プロジェクトにこのファイルを追加し、
 *       setupBookingTrigger を1回だけ実行する（初回は権限承認が必要）。
 *       秘密鍵は既存の コード.gs の定数 INBOUND_SECRET をそのまま使う（ここでは再定義しない）。
 */
const BK = {
  ENDPOINT: "https://minpaku-board.vercel.app/api/inbound",
  NEW_QUERY: 'subject:("新しい予約がありました") newer_than:3d',
  CANCEL_QUERY: 'subject:(キャンセル) from:booking newer_than:3d',
};

function runBookingSync() {
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty("bk_done") || "{}");
  const now = Date.now();

  // 新規予約
  GmailApp.search(BK.NEW_QUERY, 0, 60).forEach((th) => th.getMessages().forEach((msg) => {
    const id = msg.getId();
    if (done[id]) return;
    const p = parseBookingNew_(msg.getSubject(), msg.getPlainBody());
    done[id] = now;
    if (!p) return;
    const ok = bkPost_({ kind: "booking_new", message_id: "bk:" + id, res_id: p.res_id, hotel_id: p.hotel_id, check_in: p.check_in, listing: p.listing });
    if (!ok) delete done[id];   // 失敗時は次回再試行
  }));

  // キャンセル（email_bookings を無効化して誤検知を防ぐ）
  GmailApp.search(BK.CANCEL_QUERY, 0, 60).forEach((th) => th.getMessages().forEach((msg) => {
    const k = "c" + msg.getId();
    if (done[k]) return;
    const body = msg.getPlainBody();
    const resId = (body.match(/res_id=(\d+)/) || body.match(/(\d{8,})/) || msg.getSubject().match(/(\d{8,})/) || [])[1];
    done[k] = now;
    if (resId) bkPost_({ kind: "booking_cancel", message_id: "bkc:" + msg.getId(), res_number: resId });
  }));

  // 7日より古い処理済みIDは捨てる
  Object.keys(done).forEach((kk) => { if (now - done[kk] > 7 * 864e5) delete done[kk]; });
  props.setProperty("bk_done", JSON.stringify(done));
}

/** Booking の新規予約メールから res_id / hotel_id / チェックイン日 を取り出す */
function parseBookingNew_(subject, body) {
  const link = body.match(/res_id=(\d+)&hotel_id=(\d+)/) || [];
  const res_id = link[1] || (subject.match(/[（(]\s*(\d{6,})/) || [])[1] || "";
  const hotel_id = link[2] || (body.match(/hotel_id=(\d+)/) || [])[1] || "";
  const dm = subject.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!res_id || !dm) return null;
  const check_in = dm[1] + "-" + ("0" + dm[2]).slice(-2) + "-" + ("0" + dm[3]).slice(-2);
  let listing = "";
  const lm = body.match(/\n\s*([A-Za-z0-9][^\n]{3,80})\n/);   // ベストエフォート（照合の主役は hotel_id）
  if (lm) listing = lm[1].trim();
  return { res_id: res_id, hotel_id: hotel_id, check_in: check_in, listing: listing };
}

function bkPost_(payload) {
  payload.secret = INBOUND_SECRET;
  try {
    const res = UrlFetchApp.fetch(BK.ENDPOINT, { method: "post", contentType: "application/json", muteHttpExceptions: true, payload: JSON.stringify(payload) });
    console.log(payload.kind, payload.res_id || payload.res_number, res.getResponseCode(), res.getContentText().slice(0, 120));
    return res.getResponseCode() === 200;
  } catch (e) { console.log("post error", e); return false; }
}

/** 1回だけ実行：15分ごとのトリガーを作成 */
function setupBookingTrigger() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "runBookingSync").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runBookingSync").timeBased().everyMinutes(15).create();
}
