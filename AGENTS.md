# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## プロジェクト概要

ThreeBodyは、マルチモーダルAI体験を探求するプロトタイプです。1〜3つのLLM（「体」）を設定し、粒子球体UI（`VoiceSphere.vue`）を通じて音声で会話します。複数のLLM（Ollama・OpenAI・Anthropic・DeepSeekを自由に組み合わせ可能）が並列に回答し、主体（一体）が統合する「三体モード」が中心機能です。

## 開発コマンド

```bash
# フロントエンドのみ（Vite dev server, port 5173）
npm run dev

# バックエンドのみ（Express server, port 3000）
npm run dev:server

# 両方同時起動（通常の開発はこれ）
npm run dev:all

# 型チェック（フロント / バックエンド別々）
npx vue-tsc --noEmit
npm run typecheck:backend

# Lint
npm run lint

# テスト（vitest, jsdom環境）
npm run test
npx vitest run src/composables/__tests__/useChat.test.ts   # 単一ファイル
```

テスト対象は `src/composables/__tests__/**/*.test.ts` と `backend/tests/**/*.test.ts`（vitest.config.ts）。

## アーキテクチャ

### フロントエンド (`src/`)
- **Vue 3 Composition API** + TypeScript + Tailwind CSS v4
- **ルーティング**: 
- `src/router/index.ts` — `/`（要認証）、`/login`、`/signup`（`/login`にリダイレクト）、`/auth/callback`
- `/c/:id` -（ChatView, requiresAuth）— 会話への直リンク用ルート
- **認証**: Supabase Auth（Google OAuth, PKCEフロー）。`useAuth.ts` がセッションをモジュールレベルの singleton として保持し、`router.beforeEach` が `/` へのアクセスをガードする

### バックエンド (`backend/`)
- Express サーバー。エントリポイントは `backend/index.ts`（`loadEnv.ts` で `.env` を読み込んでからルーターをマウントするだけ）。SSE（Server-Sent Events）形式でストリーミングレスポンスを返す
- `backend/routes/` — `chat.ts`（`POST /api/chat`、三体モードのオーケストレーション含む）/ `capabilities.ts`（`GET /api/capabilities`）/ `health.ts`（`GET /api/health`）
- `backend/llm/` — プロバイダー横断の型・設定・変換処理。`types.ts`（`Provider`/`BodyConfig`/`LevelConfig` 等）、`modelConfig.ts`（`M`/`LEVEL_CONFIG`）、`messageHelpers.ts`（メッセージ形式変換）、`textService.ts`（`streamBodyOAI`/`streamSecondaryBody` のプロバイダー横断オーケストレーション）
- `backend/llm/providers/` — プロバイダーごとのストリーミング実装。`anthropic.ts` / `openaiCompat.ts`（openai/deepseek共通、`createOpenAICompatClient(body: BodyConfig)` に一本化）/ `ollama.ts`
- `backend/utils/` — `errorSanitize.ts` / `jstDate.ts` など汎用の純関数
- `backend/auth.ts` / `backend/sharedKey.ts` / `backend/supabaseAdmin.ts` はトップレベルに配置（Supabase/認証まわりのドメインロジック）
- Anthropic → 共有ファクトリなし、呼び出し箇所ごとに `new Anthropic({ apiKey })` を直接生成（`llm/providers/anthropic.ts` に1箇所、`llm/textService.ts` に2箇所、`routes/chat.ts` に1箇所の計4箇所）
- Ollamaのreasoningモデル（deepseek-r1等）は思考内容を `content` ではなく `delta.reasoning` に返すため、フォールバックで拾っている

### 状態管理パターン
Composables はモジュールレベルのシングルトンとして設計されており、コンポーネント間で状態を共有する（Piniaは使っていない）：
- `useChat.ts` — `messages` / `pendingBodies` / `aiState` を module-level `ref` として保持し、Supabaseとの永続化・会話管理
- `useSettings.ts` — `settings`（プロバイダー・モデル・三体設定など）を `reactive` として保持し、`localStorage` に自動永続化。APIキーだけは平文ではなく `lib/keyVault.ts` の `encryptText`/`decryptText` で暗号化して保存する
- `useAuth.ts` — `user` を module-level `ref` として保持。`onAuthStateChange` を購読
- `useCapabilities.ts` — `sharedKey` / `ollama`（`GET /api/capabilities` の結果）を module-level `ref` として保持
- `useTheme.ts` — `isDark` を module-level `ref` として保持し `localStorage` に永続化
- `useAsideDrawer.ts` — `asideOpen`（サイドバー開閉）を module-level `ref` として保持

### 会話の永続化（Supabase）
`conversations` → `messages` → `content_blocks` の3テーブル構成（`useChat.ts` 内で直接クエリ）：
<!-- - 1ユーザー1アクティブセッションが前提（会話切り替えUIはまだ無い）。最後のメッセージから6時間（`SESSION_IDLE_MS`）経過していたら新しいセッションを自動的に開始し、古いセッションは `ended_at` を付けてアーカイブ扱いにする -->
- `startNewConversation()` — 画面をクリアするだけ、DB書き込みは初回メッセージ送信まで遅延
- `switchConversation(id)` - 会話を切り替えて履歴をリロードする
- `renameConversation(id, title)`
- `deleteConversation(id)` - messages/content_blocksも連鎖的に削除させる。
- `conversations.user_id` は `user_setting.id` への外部キーのため、`ensureUserProfile()` で先にプロフィール行をupsertしてから会話を作る
- エラーブロック（`type: 'error'`）と見解ブロック（`type: 'perspective'`）はDBに保存しない一時表示用（`persistMessage` は `text` ブロックのみ抽出）

### メッセージのブロック構造
`src/types/message.ts` で定義。各メッセージは `blocks: ContentBlock[]` を持つ：
- `text` — 通常の本文（三体モードでは `bodyIndex` でどの体の回答かを保持）
- `error` — エラー表示用（非永続化）
- `perspective` — 三体モードで副体の回答をリアルタイム表示する一時ブロック（非永続化）。`bodies: BodyPerspective[]` に各体の `content`/`done` を保持

### 三体モード（マルチLLM）
`/api/chat` が `bodies` 配列（`BodyConfig[]`、`provider`/`apiKey`/`model` を持つ）を受け取り、有効な体が2つ以上あると三体モードになる：
1. 先頭以外の体（副体＝二体・三体）に並列でリクエスト（最大 512 トークン）。`streamSecondaryBody()` が `body_start` → `body_text`（逐次） → `body_done` イベントをSSEで送出し、フロントが `pendingBodies` / `perspective` ブロックにリアルタイム反映する
2. 各副体の見解を `【○体（provider）の見解】` 形式でシステムプロンプトに注入
3. 先頭の体（主体＝一体）が `synthesis_start` イベント後、統合回答を `text` イベントでストリーミング出力
4. 体が1つだけ有効な場合は通常のストリーミング（`streamBodyOAI`）、単体モード（`bodies` 未指定）では `provider`/`model`/`apiKey` を直接使う

フロント側の `aiState`（`useChat.ts`）は `idle → thinking → synthesizing → converging → idle` と遷移する。

### 思考レベル（1〜5）
`LEVEL_CONFIG` でモデルとトークン上限をマッピング：
- Level 1-2: Fast モデル
- Level 3: Balanced モデル
- Level 4: Balanced + thinking（`thinkingBudget: 8000`、Sonnet系で有効。deprecatedだが機能する）
- Level 5: Powerful + adaptive thinking（Opus専用。`budget_tokens` は使えないため `type: 'adaptive'`）

### APIエンドポイント
| エンドポイント | 説明 |
|---|---|
| `POST /api/chat` | SSEチャット（三体モード対応） |
| `GET /api/health` | ヘルスチェック |

## 環境変数 (`.env`)

フロントエンド（`VITE_` プレフィックス）とバックエンド両方の変数が同一ファイルに存在する。

- **モデル更新**: `ANTHROPIC_MODEL_FAST/BALANCED/POWERFUL`、`OPENAI_MODEL_*`、`DEEPSEEK_MODEL_*`、`OLLAMA_MODEL_DEFAULT` を書き換えるだけでモデル変更可能
- `VITE_API_BASE_URL`: バックエンドのURL（デフォルト `http://localhost:3000`）
- `VITE_ORIGIN_BASE_URL`: `backend/index.ts` がCORSのoriginとして読んでいる（backend消費）
- `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`: バックエンド用（`SERVICE_KEY`はRLSバイパス用、現状serverでは未使用）
- `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`: フロント用Supabaseクライアント（`src/lib/supabase.ts`）
- `OLLAMA_BASE_URL`/`OLLAMA_NUM_PARALLEL`/`OLLAMA_FLASH_ATTENTION`: ローカルLLM用
- `SHARED_ANTHROPIC_API_KEY`: 共有APIキー（ユーザー、一日分の無料お試し枠用のAPIキー）
- `OLLAMA_ENABLED`: ollamaの利用可否の宣言用の引数（`backend/llm/providers/ollama.ts`, デプロイ先ごとのOllama利用可否宣言、未設定時はtrue扱い）

## 主要コンポーネント

すべて `src/components/` 配下。画面は `src/views/ChatView.vue` がこれらを組み立てている。

- `AppAside.vue` — 左サイドバー。会話一覧（切替・リネーム・削除、複数並存）とアカウント操作。`SettingsDialog` はここにマウントされている（`AppAside.vue:184`）
- `AppHeader.vue` — ヘッダー。会話タイトルの表示・インライン編集、新規会話、テーマ切替（`useTheme`）、サイドバー開閉（`useAsideDrawer`）
- `VoiceSphere.vue` — Canvas 粒子球体。本アプリのビジュアルの中核。props ではなく `useChat` の `aiState` / `pendingBodies` と `useSettings` の `bodies` を直接購読し、有効な体の数だけ粒子クラスタ（最大3）に分裂させて `constants/bodyProviders.ts` の `BODY_PROVIDER_COLORS` で塗り分ける。球体そのものの色は 録音中=赤 / ウェイクワード待機中=紫 / 待機=シアン
- `VoiceSphereDialog.vue` — 全画面の音声モーダル。`VoiceSphere` をラップし、マイク切替・確認送信・録り直しを emit する（`defineExpose` の `open()` / `close()` で開閉）
- `MessageList.vue` / `MessageBubble.vue` — 会話ログ。`MessageBubble` がブロック種別（`text` / `error` / `perspective`）ごとの描画と、再送・削除・エラー報告（`useFeedback`）を担う
- `EmptyBrainState.vue` — 脳（体）が未設定のときの空状態。共有キーの状態（`not_signed_in` / `limit_reached` / それ以外）でメッセージを出し分け、「未設定」と「無料枠を使い切った」を混同させない
- `SettingsDialog.vue` — 設定（プロバイダー・モデル・三体設定）
- `ThreeBodyLogo.vue` — 三体問題の軌道を模した SVG アニメーションロゴ


## 音声機能

- `useVoiceInput.ts` — Web Speech API で音声認識、コールバックで送信
- `useWakeWord.ts` — 「アイリス」でウェイクワード検知 → 録音開始
- `useTTS.ts` — SpeechSynthesis API でAI応答を読み上げ

録音中はウェイクワード検知を停止し、同一マイクの競合を防ぐ（`ChatView.vue:91` の `watch(recording, ...)`）。
