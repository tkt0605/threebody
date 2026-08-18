# CLAUDE.md

ThreeBody — 1〜3個のLLM（「体」）が並列に回答し、主体（一体）が統合する音声チャット。Vue 3 + Express、SSEストリーミング。

## コマンド

```bash
npm run dev:all              # フロント(5173) + バック(3000)
npm run lint
npm run test                 # vitest
npx vue-tsc --noEmit         # フロント型チェック
npm run typecheck:backend
```

テスト対象: `src/composables/__tests__/**/*.test.ts`, `backend/tests/**/*.test.ts`

## 構成

- `src/` — Vue 3 Composition API / TypeScript / Tailwind v4。`views/ChatView.vue` が全体を組み立てる
- `backend/` — Express。`index.ts` から `routes/`（chat・capabilities・health・account）、`llm/`（`types.ts` / `modelConfig.ts` / `textService.ts` / `providers/`）、`utils/` をマウント
- 永続化 — Supabase `conversations` → `messages` → `content_blocks`。クエリは `useChat.ts` に集約

ファイル単位の説明はここに書かない。必要なら実物を読むこと。

## 前提（コードを読んでも分からない決定事項）

### 状態管理

- Pinia は使わない。composables はモジュールレベルの singleton（`ref` / `reactive` をモジュールスコープに置く）。新しい状態を足すときもこの形式に合わせる
- `useSettings` は localStorage に自動永続化。APIキーだけは平文にせず `lib/keyVault.ts` で暗号化する

### データ

- `conversations.user_id` は `user_setting.id` への外部キー。会話作成の前に `ensureUserProfile()` が必須
- `error` / `perspective` ブロックは非永続化。`persistMessage` は `text` ブロックのみ抽出する
- 退会だけがバックエンドにあるのは、`auth.users` の行が service_role でしか消せないため。会話削除がフロント完結なのは RLS の範囲内で閉じる操作だから

### 三体モード

- 有効な体が2つ以上で発動。副体を並列実行（最大512トークン）→ `【○体（provider）の見解】` の形式で主体のシステムプロンプトに注入 → 主体が統合回答をストリーム
- SSE イベント順: `body_start` / `body_text` / `body_done` → `synthesis_start` → `text`
- `aiState` の遷移: `idle → thinking → synthesizing → converging → idle`
- 副体が全滅した場合は単体モードに縮退する（1体の失敗で全体を落とさない）

### プロバイダー

- Ollama の reasoning モデル（deepseek-r1 等）は思考内容を `content` ではなく `delta.reasoning` に返す。フォールバックで拾う
- 思考レベル 4 = `thinkingBudget: 8000`（Sonnet系）。レベル 5 = Opus専用で `budget_tokens` が使えないため `type: 'adaptive'`
- OpenAI / DeepSeek は `createOpenAICompatClient` に一本化済み。Anthropic だけ共有ファクトリがなく、呼び出し箇所ごとに `new Anthropic()` している

### ルーティング / UI

- `/terms` `/privacy` に `requiresAuth` を付けない。未ログインで読めないと `LoginView` の同意文が成立せず、Google OAuth の審査も通らない
- 「体が未設定」と「無料枠を使い切った」を同じ表示で混同させない
- ライブリージョンには `aiState` の変化と応答完成時だけを流す。ストリーミング中の本文は流さない（毎トークン読み直されるため）

### 音声

- マイクは1本しかない。占有の決定は `ChatView.vue` の `syncListening()` 一箇所のみ。他の場所から録音を start / stop しない
- `TextComposer` は読み上げを起動しない（文字で打った人に音声を返さない）。IME変換中の Enter は送信しない
- 無音からの自動送信までの待ち時間は固定値ではなく `lib/endpointing.ts` が認識文字列から決める

### 環境変数

- `.env` にフロント（`VITE_` 接頭辞）とバック両方の変数が同居している
- `VITE_ORIGIN_BASE_URL` は接頭辞に反してバックエンドが CORS origin として読む
- `OLLAMA_ENABLED` は未設定時 true 扱い
- モデル変更は `*_MODEL_FAST` / `_BALANCED` / `_POWERFUL` の書き換えだけで完結させる

## 出力ルール

- 結論を最初の1〜2行に書く。前置き、着手宣言、末尾の要約再掲はしない
- 変更したファイルは `パス: 一行の要約` のみ。コード全文は貼らない。差分は変更行の前後3行まで
- コマンド結果はエラー行と判断に必要な行だけ引用する。成功したものは `OK` の一語
- 提案は最大3つ。超える分は「他N件」とだけ書く
- 完了報告は3行以内（何をしたか / 何が変わったか / 次に必要なこと）
- 謝罪、感想、自己評価、作業の意義の説明は書かない
- 調査は必要最小限のファイルだけ読む。読んだファイルの一覧は報告しない

## 精度ルール

- 確認していない型・API・関数名・ファイル名は断定せず `[要確認]` を付ける。推測で埋めない
- 命名、エラー処理、SSEイベント名は周辺の既存コードに合わせる。新しいパターンを持ち込むときは `[要判断]`
- 私の判断が必要な箇所は行頭に `[要判断]`
- 本ファイルと実装の食い違いは、作業中に読んだ範囲で気づいたときだけ `[要判断]` で報告する。照合のための追加調査はしない