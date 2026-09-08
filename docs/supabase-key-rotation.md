# Supabase API キー移行手順

旧 JWT キー（`anon` / `service_role`）から、publishable key（`sb_publishable_`）と
secret key（`sb_secret_`）へ移行する。新旧キーは同時に有効化できるため、先に新キーを
配布して全経路を確認し、最後に旧キーを無効化する。

## 配置

| 環境 | 変数 | 値 |
| --- | --- | --- |
| ローカル `.env` | `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key |
| ローカル `.env` | `SUPABASE_SECRET_KEY` | secret key |
| Vercel Production | `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key |
| Render | `SUPABASE_SECRET_KEY` | secret key |

`VITE_SUPABASE_URL` は従来どおりローカル・Vercel・Renderで共用する。secret key は
ブラウザへ展開される `VITE_` 変数や Vercel には置かない。

## 切り替え順

1. Supabase Dashboard の **Settings > API Keys** で default の publishable key と
   secret key を作る。この時点では旧キーを無効化しない。
2. ローカル `.env`、Vercel Production、Render に上表の新しい変数を追加する。
3. フロントを再ビルドして Vercel Production へ、バックエンドを Render へデプロイする。
4. 下の「新キー経路」をすべて確認する。
5. Supabase Dashboard で旧 `anon` / `service_role` key を無効化する。
6. `.env` に旧キーを一時的に `RETIRED_SUPABASE_ANON_KEY` と
   `RETIRED_SUPABASE_SERVICE_ROLE_KEY` として入れ、`npm run verify:supabase-rotation` を実行する。
   両方が HTTP 401 になったら、この2変数を直ちに削除する。
7. Vercel / Render / ローカルから旧変数 `VITE_SUPABASE_ANON_KEY` と
   `SUPABASE_SERVICE_KEY` を削除する。

## 完了チェックリスト

### 新キー経路

- [ ] ログイン → 会話作成 → 送信 → 削除（publishable key + RLS、`resolveUserId`）
- [ ] クラウドキー未設定のアカウントで1往復（共有キー経路 + `SHARED_ANTHROPIC_API_KEY`）
- [ ] 共有リンクを発行し、ログアウト状態の別ブラウザで `/s/:token` を開く
- [ ] テストアカウントで退会（`backend/routes/account.ts` の secret key 経路）
- [ ] `/api/health` が `supabase: true` / `sharedKey: true`
- [ ] 1時間以上放置後に操作し、トークンリフレッシュを確認
- [ ] `node scripts/verify-share-rls.mjs` が通る

### 旧キー停止

- [ ] `npm run verify:supabase-rotation` で旧 `anon` key が 401
- [ ] `npm run verify:supabase-rotation` で旧 `service_role` key が 401

時間経過だけでは未使用の経路を検証できないため、上の経路がすべて通ったことを完了条件とする。
