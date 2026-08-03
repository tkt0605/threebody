# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ThreeBodyは、マルチモーダルAI体験を探求するプロトタイプです。1〜3つのLLMノード（「体」）を三角形に配置し、その重心で音声チャットを行います。複数のLLM（Ollama・OpenAI・Anthropic・DeepSeekを自由に組み合わせ可能）が並列に回答し、主体（一体）が統合する「三体モード」が中心機能です。

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

テスト対象は `src/composables/__tests__/**/*.test.ts` と `backend/src/__tests__/**/*.test.ts`（vitest.config.ts）。

## アーキテクチャ

### フロントエンド (`src/`)
- **Vue 3 Composition API** + TypeScript + Tailwind CSS v4
- **ルーティング**: `src/router/index.ts` — `/`（要認証）、`/login`、`/signup`（`/login`にリダイレクト）、`/auth/callback`
- **認証**: Supabase Auth（Google OAuth, PKCEフロー）。`useAuth.ts` がセッションをモジュールレベルの singleton として保持し、`router.beforeEach` が `/` へのアクセスをガードする

### バックエンド (`backend/src/server.ts`)
- **単一ファイル** の Express サーバー。SSE（Server-Sent Events）形式でストリーミングレスポンスを返す
- モデル設定は `.env` の環境変数で管理（コードは変更不要、`LEVEL_CONFIG` が参照する）
- プロバイダーごとに `createBodyClient()` でクライアントを切り替え（Anthropic SDK / OpenAI互換SDK）。Ollama・DeepSeekはOpenAI互換エンドポイントとして扱う
- Ollamaのreasoningモデル（deepseek-r1等）は思考内容を `content` ではなく `delta.reasoning` に返すため、フォールバックで拾っている

### 状態管理パターン
Composables はモジュールレベルのシングルトンとして設計されており、コンポーネント間で状態を共有する（Piniaは使っていない）：
- `useChat.ts` — `messages` / `pendingBodies` / `aiState` / `archivedSessions` を module-level `ref` として保持し、Supabaseとの永続化・セッション管理も担う
- `useTriangleNodes.ts` — `placedNodes` を module-level `ref` として保持
- `useSettings.ts` — `settings`（プロバイダー・モデル・三体設定など）を `reactive` として保持し、`localStorage` に自動永続化
- `useAuth.ts` — `user` を module-level `ref` として保持。`onAuthStateChange` を購読

### 会話の永続化（Supabase）
`sessions` → `messages` → `content_blocks` の3テーブル構成（`useChat.ts` 内で直接クエリ）：
- 1ユーザー1アクティブセッションが前提（会話切り替えUIはまだ無い）。最後のメッセージから6時間（`SESSION_IDLE_MS`）経過していたら新しいセッションを自動的に開始し、古いセッションは `ended_at` を付けてアーカイブ扱いにする
- `archiveCurrentSession()` で明示的にアーカイブして新しい会話を始めることも可能。サイドバー（`AppAside.vue`）にアーカイブ済みセッション一覧を表示し、`ArchiveViewerDialog.vue` で読み取り専用表示、削除も可能
- `sessions.user_id` は `user_setting.id` への外部キーのため、`ensureUserProfile()` で先にプロフィール行をupsertしてからセッションを作る
- エラーブロック（`type: 'error'`）と見解ブロック（`type: 'perspective'`）はDBに保存しない一時表示用（`persistMessage` は `text` ブロックのみ抽出）

### メッセージのブロック構造
`src/types/message.ts` で定義。各メッセージは `blocks: ContentBlock[]` を持つ：
- `text` — 通常の本文（三体モードでは `bodyIndex` でどの体の回答かを保持）
- `error` — エラー表示用（非永続化）
- `perspective` — 三体モードで副体の回答をリアルタイム表示する一時ブロック（非永続化）。`bodies: BodyPerspective[]` に各体の `content`/`done` を保持
- `image` / `map` / `game` は将来用（未実装）

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
- `VITE_ORIGIN_BASE_URL`: フロントエンドのURL（CORSに使用）
- `SUPABASE_URL`/`SUPABASE_KEY`/`SUPABASE_SERVICE_KEY`: バックエンド用（`SERVICE_KEY`はRLSバイパス用、現状serverでは未使用）
- `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`: フロント用Supabaseクライアント（`src/lib/supabase.ts`）
- `OLLAMA_BASE_URL`/`OLLAMA_NUM_PARALLEL`/`OLLAMA_FLASH_ATTENTION`: ローカルLLM用

## 主要コンポーネント

- `AppAside.vue` — 左サイドバー（三角形のNode配置UI、アーカイブ済みセッション一覧）
- `AppRightSidebar.vue` — 右サイドバー（テキスト入力・音声UI）
- `NodeCanvas.vue` — 三角形のドラッグ配置キャンバス
- `SettingsDialog.vue` — 設定（プロバイダー・モデル・三体設定）
- `McpDialog.vue` / `McpPanel.vue` — MCPサーバー管理（現状UIのみ、バックエンド未連携）
- `ArchiveViewerDialog.vue` — アーカイブ済みセッションの読み取り専用表示

## 音声機能

- `useVoiceInput.ts` — Web Speech API で音声認識、コールバックで送信
- `useWakeWord.ts` — 「アイリス」でウェイクワード検知 → 録音開始
- `useTTS.ts` — SpeechSynthesis API でAI応答を読み上げ

録音中はウェイクワード検知を停止し、同一マイクの競合を防ぐ（`ChatView.vue:41`）。
