/**
 * 駐車場希望の自動検知（W14など駐車場を共有する建物向け）
 *
 * 1時間ごとに Airbnb のゲストメッセージ通知を確認し、
 * 駐車場・車に触れた発言があればボード（/api/inbound）に送る。判定はボード側で行う：
 *   - 希望と読み取れる＋空き        → 🚗を付けて通知
 *   - 希望と読み取れる＋被り        → 🚗は付けずに被り通知
 *   - 質問だけ                       → 🚗は付けずに要確認通知（空き状況つき）
 *   - 問い合わせ段階（予約前）の希望 → 保存し、予約がボードに入った時点で🚗（または被り通知）
 * 通知はボード側の通知キューに溜まり、このスクリプトが NOTIFY_TO にメールで送る。
 *
 * 設置: 既存の runInbound と同じ Apps Script プロジェクトにこのファイルを追加し、
 *       setupParkingTrigger を1回だけ実行する。
 */
const PK = {
  ENDPOINT: "https://minpaku-board.vercel.app/api/inbound",
  SECRET: "ここに INBOUND_SECRET",           // 既存の runInbound と同じ値
  NOTIFY_TO: "minpaku@fly-arts.com",
  QUERY: "from:(express@airbnb.com OR automated@airbnb.com) newer_than:2d",
  // ゲストのメッセージ（日本語の自動翻訳を含む）にこれが含まれたら「駐車場希望」とみなす
  KEYWORDS: /駐車|パーキング|車で(行|来|伺|向|移動|訪)|車を(停|止|置)|お車|レンタカー|自家用車|マイカー|parking|park (my |the |a |our )?cars?|rental car|by car|drive there|driving/i,
};

function runParking() {
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty("pk_done") || "{}");   // 処理済みメッセージID
  const now = Date.now();

  GmailApp.search(PK.QUERY, 0, 100).forEach((thread) => {
    thread.getMessages().forEach((msg) => {
      const id = msg.getId();
      if (done[id]) return;
      const parsed = parseParkingMessage_(msg.getPlainBody());
      done[id] = now;
      if (!parsed || !PK.KEYWORDS.test(parsed.text)) return;

      const res = UrlFetchApp.fetch(PK.ENDPOINT, {
        method: "post",
        contentType: "application/json",
        muteHttpExceptions: true,
        payload: JSON.stringify(Object.assign({ secret: PK.SECRET, kind: "parking_request", message_id: "pk:" + id }, parsed)),
      });
      let r = {};
      try { r = JSON.parse(res.getContentText()); } catch (e) {}
      console.log(id, res.getResponseCode(), JSON.stringify(r));
      if (res.getResponseCode() !== 200) { delete done[id]; return; }   // 失敗時は次回再試行
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

function post_(obj) {
  const res = UrlFetchApp.fetch(PK.ENDPOINT, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ secret: PK.SECRET }, obj)),
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return {}; }
}

/** 1回だけ実行：1時間ごとのトリガーを作成 */
function setupParkingTrigger() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "runParking").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runParking").timeBased().everyHours(1).create();
}
