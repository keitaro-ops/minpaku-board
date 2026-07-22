# 予約統合ボード（民泊 / Airbnb + Booking）

各サイトの **iCal** を集約し、物件ごとのタイムライン（ガント）とリストで
「どの物件に・いつからいつまで・どのサイトの予約が・何件」入っているかを1画面で見るツールです。
共有パスワードで、PC・スマホのブラウザから複数人が閲覧できます。

## できること / 仕様

- Airbnb / Booking の予約を**予約ごとに別バー**で表示（隣接する連泊も別件として数える）。
- 双方向カレンダー連携で両サイトに出る同一日程は**自動で重複排除**。
- ブロック（予約枠外）は灰色表示で件数から除外。
- Airbnb は iCal に予約詳細URLが入るため、詳細から**予約ページを開く**リンクあり。

### 既知の限界（重要）

Booking は自分の iCal でも予約を「CLOSED - Not available」と伏せるため、
**「予約」と「手動ブロック」を機械的に完全区別できません**。本ツールは既定で
Booking の枠を「予約」として計上し、稀な「Booking 側の手動ブロック」は
**詳細画面から1タップで「ブロック」に訂正**できます（訂正は保存され、同期で消えません）。
Airbnb 側は "Reserved" + URL で明確なので、この問題はありません。

---

## 構成

```
各サイトの iCal ──(毎時)──▶ /api/cron ──▶ 解析・統合 ──▶ Postgres ──▶ Web(ボード)
                                                   ▲
                                          GitHub Actions cron
```

- フロント/バックエンド: Next.js（Vercel にデプロイ）
- DB: Postgres（Supabase / Neon / Vercel Postgres いずれか）
- 定期同期: GitHub Actions が毎時 `/api/cron` を叩く（Vercel Cron でも可）
- 認証: 共有パスワード1つ（Cookie）

---

## セットアップ手順

### 1. データベースを用意
Supabase か Neon で Postgres を作成し、接続URL（`postgres://...`）を控える。
SQL エディタで `sql/schema.sql` を実行してテーブルを作成。

### 2. GitHub に push
このフォルダをそのまま GitHub リポジトリにする。

### 3. Vercel にデプロイ
[vercel.com](https://vercel.com) で「Import Project」→ このリポジトリを選択。
**Environment Variables** に以下を設定（`.env.example` 参照）:

| 変数 | 内容 |
| --- | --- |
| `DATABASE_URL` | Postgres 接続URL |
| `DASHBOARD_PASSWORD` | 共有パスワード（強めに） |
| `APP_SECRET` | ランダムな長い文字列 |
| `CRON_SECRET` | 定期同期用のランダム文字列 |

Deploy 後、`https://あなたのアプリ.vercel.app` が公開URL。

### 4. 物件と iCal URL を登録
公開URLを開き、パスワードでログイン → 右下「物件・iCal設定」→
各リスティングのエクスポートURLを追加 → **「今すぐ同期」**。

- **Airbnb**: リスティング → カレンダー → 空室状況 → 「カレンダーを接続」→ カレンダーをエクスポート（.ics URL）
- **Booking**: エクストラネット → カレンダー → カレンダーを同期 → エクスポート（.ics URL）

同じ物件について Airbnb と Booking の両方を、それぞれ platform を選んで登録します。

### 5. 定期同期を有効化（GitHub Actions）
リポジトリの Settings → Secrets and variables → Actions に:
- `APP_URL` = 公開URL（例 `https://あなたのアプリ.vercel.app`）
- `CRON_SECRET` = Vercel に設定したものと同じ値

`.github/workflows/sync.yml` が毎時同期します（頻度は cron 式で変更可）。

---

## スマホで使う
公開URLをスマホのブラウザで開くだけ。iOS/Android とも「ホーム画面に追加」で
アプリのように起動できます（別アプリの開発は不要）。

## コスト
Supabase 無料枠（DB 500MB 等）で 35 物件規模は十分。定期同期が動いていれば
無料プロジェクトの自動休止も回避できます。確実性重視なら Supabase Pro（月 $25 前後）。

## ローカル開発
```
cp .env.example .env.local   # 値を設定
npm install
npm run dev                  # http://localhost:3000
```

## この先の拡張（任意）
- Booking の参照リンクや、手動ブロックの完全区別が必要になったら、
  Booking の予約確定メール解析を足すのが確実（本ツールの iCal と併用可能）。
- 個別ログイン（招待制）にしたい場合は Supabase Auth に置き換え可能。
