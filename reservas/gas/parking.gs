/**
 * 駐車場希望の自動検知（W14など駐車場を共有する建物向け）
 *
 * 1時間ごとに Airbnb のゲストメッセージ通知を確認し、駐車場を共有する建物（W14）の
 * 部屋宛てのメッセージをボード（/api/inbound）に送る。判定・記録はボード側で行う：
 *   - 希望と読み取れる＋空き        → 🚗を付けて通知
 *   - 希望と読み取れる＋被り        → 🚗は付けずに被り通知
 *   - 質問だけ                       → 🚗は付けずに要確認通知（空き状況つき）
 *   - 問い合わせ段階（予約前）の希望 → 保存し、予約がボードに入った時点で🚗（または被り通知）
 *   - 手動の🚗とゲストの発言が食い違う          → 食い違い通知
 * 発言は予約ごとに記録され、ボードに「🅿要/🅿不/🅿？/🅿未」として表示される。
 * 通知はボード側の通知キューに溜まり、このスクリプトが NOTIFY_TO にメールで送る。
 * 過去分の取り込みは runParkingBackfill を（完了と出るまで）手動実行する。
 *
 * 設置: 既存の runInbound と同じ Apps Script プロジェクト（minpaku-inbound）に追加し、
 *       setupParkingTrigger を1回だけ実行する。INBOUND_SECRET はコード.gs の定数を使う。
 */
const PK = {
  ENDPOINT: "https://minpaku-board.vercel.app/api/inbound",
  NOTIFY_TO: "minpaku@fly-arts.com",
  QUERY: "from:(express@airbnb.com OR automated@airbnb.com) newer_than:2d",
  // 過去分の取り込み対象。W14のリスティング名に含まれる語で絞る（全Airbnbメールだと数千件で時間がかかるため）
  BACKFILL_QUERY: "from:express@airbnb.com newer_than:400d (subject:和モダン OR subject:ヴィンテージ)",
};

function runParking() {
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty("pk_done") || "{}");   // 処理済みメッセージID
  const now = Date.now();
  const rooms = post_({ kind: "parking_rooms" }).rooms || [];   // 対象の部屋ID（W14の2部屋）
  if (!rooms.length) { console.error("parking_rooms が取得できません"); return; }

  GmailApp.search(PK.QUERY, 0, 100).forEach((thread) => {
    thread.getMessages().forEach((msg) => {
      const id = msg.getId();
      if (done[id]) return;
      const parsed = parseParkingMessage_(msg.getPlainBody());
      done[id] = now;
      if (!parsed || rooms.indexOf(parsed.room_id) < 0 || !parsed.text) return;
      const code = sendMessage_("pk:" + id, msg, parsed, false);
      if (code !== 200) delete done[id];   // 失敗時は次回再試行
    });
  });

  // 保存済みの希望を予約に反映 → 未送信の通知をメールで送り、送信済みにする
  const poll = post_({ kind: "parking_poll" });
  const sent = [];
  (poll.notices || []).forEach((n) => {
    try { MailApp.sendEmail(PK.NOTIFY_TO, n.subject, n.body); sent.push(n.id); }
    catch (e) { console.error("mail failed", n.id, e); }
  });
  if (sent.length) post_({ kind: "parking_ack", ids: sent });
  console.log("poll", JSON.stringify(poll.applied || []), "mailed", sent.length);

  // 7日より古い処理済みIDは捨てる（プロパティ容量対策）
  Object.keys(done).forEach((k) => { if (now - done[k] > 7 * 864e5) delete done[k]; });
  props.setProperty("pk_done", JSON.stringify(done));
}

/** Airbnb メッセージ通知の本文から 部屋ID・日程・ゲストの発言 を取り出す */
function parseParkingMessage_(body) {
  const room = body.match(/airbnb\.[a-z.]+\/rooms\/(\d+)/i);
  const ciIdx = body.indexOf("チェックイン");
  if (!room || ciIdx < 0) return null;
  const dates = [...body.slice(ciIdx).matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)].slice(0, 2)
    .map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  if (dates.length < 2) return null;
  // ゲストの発言部分（安全のお知らせ〜「問い合わせを確認」の間）
  const start = body.indexOf("連絡するようにしましょう");
  let end = body.search(/問い合わせを確認|メッセージを確認|返信\s*\n?\[/);
  if (end < 0) end = body.search(/https:\/\/www\.airbnb\.[a-z.]+\/rooms\//);   // 物件情報ブロックの手前で必ず切る
  if (end < 0 || end <= start) return null;
  const text = body.slice(start > 0 ? start : 0, end)
    .replace(/\[https?:[^\]]+\]/g, "")
    .replace(/【[^】]*】/g, "");   // リスティング名（「予約制の無料駐車場」等）を誤検知しない
  const thread = body.match(/https:\/\/www\.airbnb\.[a-z.]+\/hosting\/thread\/\d+/);
  return { room_id: room[1], check_in: dates[0], check_out: dates[1], text: text.trim().slice(0, 1500), thread_url: thread ? thread[0] : "" };
}

function sendMessage_(messageId, msg, parsed, backfill) {
  const res = UrlFetchApp.fetch(PK.ENDPOINT, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ secret: INBOUND_SECRET, kind: "parking_request", message_id: messageId,
      sent_at: msg.getDate().toISOString(), backfill: backfill }, parsed)),
  });
  console.log(messageId, res.getResponseCode(), res.getContentText().slice(0, 200));
  return res.getResponseCode();
}

/**
 * 過去分の取り込み（記録だけ。🚗の付与や通知はしない）。
 * 実行時間の上限（6分）に近づくと途中で止まるので、「完了」と出るまで繰り返し実行する。
 */
function runParkingBackfill() {
  const props = PropertiesService.getScriptProperties();
  let state = JSON.parse(props.getProperty("pkb_state") || '{"start":0}');
  if (state.q !== PK.BACKFILL_QUERY) state = { start: 0, q: PK.BACKFILL_QUERY };   // 対象を変えたら最初から
  const rooms = post_({ kind: "parking_rooms" }).rooms || [];
  if (!rooms.length) { console.error("parking_rooms が取得できません"); return; }
  const t0 = Date.now();
  let sent = 0;
  while (Date.now() - t0 < 4.5 * 60 * 1000) {
    const threads = GmailApp.search(PK.BACKFILL_QUERY, state.start, 50);
    if (!threads.length) {
      props.deleteProperty("pkb_state");
      post_({ kind: "parking_backfill_done" });   // これ以降、ボードは「発言なし」も判定に使う
      console.log("完了: 今回 " + sent + " 件送信");
      return;
    }
    threads.forEach((thread) => thread.getMessages().forEach((msg) => {
      const parsed = parseParkingMessage_(msg.getPlainBody());
      if (!parsed || rooms.indexOf(parsed.room_id) < 0 || !parsed.text) return;
      sendMessage_("pkb:" + msg.getId(), msg, parsed, true);
      sent++;
    }));
    state.start += threads.length;
    props.setProperty("pkb_state", JSON.stringify(state));
  }
  console.log("途中まで（" + state.start + " スレッド）。もう一度 runParkingBackfill を実行してください。今回 " + sent + " 件送信");
}

function post_(obj) {
  const res = UrlFetchApp.fetch(PK.ENDPOINT, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ secret: INBOUND_SECRET }, obj)),
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return {}; }
}

/** 1回だけ実行：1時間ごとのトリガーを作成 */
function setupParkingTrigger() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "runParking").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runParking").timeBased().everyHours(1).create();
}
