# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ThreeBody — 1〜3個のLLM（「体」）を組み合わせる音声チャット。主体が答え、副体がその答えを検算する。Vue 3 + Express、SSEストリーミング、Supabase 永続化。

コマンド・ディレクトリ構成・コーディングスタイル・テストの置き場は `AGENTS.md` にある（ここでは繰り返さない）:

@AGENTS.md

CI（`.github/workflows/ci.yml`）は lint / `vue-tsc` / `typecheck:backend` / `vitest run` の4つを別ステップで回す。提出前に手元でも同じ4つを通す。Node は本番（Render）に合わせて 24。

## 一往復の流れ（複数ファイルにまたがる部分だけ）

### テキストの往復

1. `ChatView.vue` → `useChat.sendMessage()` が `POST /api/chat` を叩く。送るのは履歴・`thinkingLevel`・人格プロンプト・`bodies[]`（provider / apiKey / model / role）・`useSharedKey`
2. `backend/routes/chat.ts` — 認証（`resolveUserId`）→ SSE ヘッダ送出 → 経路分岐。分岐は上から順に **共有キー経路**（自前のクラウドキーが1つも無いユーザー。Anthropic 3体・思考レベル固定）→ **三体モード**（利用可能な体が2つ以上）→ **1体だけ**（`streamBodyOAI`）→ **単体モード**（`provider` フィールド。実質 Ollama フォールバック）
3. `backend/llm/textService.ts` の `orchestrateMultiBody()` が三体モードの本体。主体プロンプトは必ず `promptLayers.buildPrimaryPrompt()` を通す（層1 共通規範 + 層2 主体契約を人格の上に被せる）。副体の指示は `secondaryPrompt.ts` の `buildReview*` が role から組む。フロントは文面を作らない
4. `backend/llm/providers/` がプロバイダーごとにストリーミングし、SSE に書く
5. `useChat.ts` の SSE ハンドラが `messages[].blocks` を書き換え、完了後 `persistMessage()` が Supabase `messages` → `content_blocks` に保存する

SSE イベント順（三体モード）: `answer_start` → `text`… → `answer_done { review }` → 副体ごとに並列で `body_start` → `body_text`… → `body_done { hasFinding }` → `[DONE]`。1体・単体モードは `text` だけ。エラーは `{ type: 'error', message, code? }`（`code` は無料枠の上限など「仕様どおりの制限」の印で、フロントはこれで報告ボタンを出し分ける）

`aiState` の遷移: `idle → thinking → converging（text）→ reviewing（answer_done で review:true / body_start）→ idle`。`answer_done` で本文は完成しており、読み上げは検算の完了を待たない。

### 音声の往復

マイクは1本。`ChatView.vue` の `syncListening()` **だけ**が「録音中は `useVoiceInput`、音声ラウンド中はバージイン待ち、それ以外はウェイクワード待機（一度マイクを使った後のみ）」を決める。他の場所から認識器を start / stop しない。`useWakeWord`（「アイリス」）→ `useVoiceInput`（認識・無音判定）→ `sendMessage` → `useVoiceNarration`（文単位の逐次読み上げ、`splitSentences` / `stripMarkdown` でコード・CLI を声に乗せない）。

### 共有（`/s/:token`）

`useSharedTurn.ts` が `shared_messages` に行を作り、閲覧側はバックエンドを通さず anon key で Supabase を直接読む（何人見ても無料枠が減らない、がこの機能の存在理由）。RLS の正本は `docs/schema.sql`。実プロジェクトに対する検証は `scripts/verify-share-rls.mjs`。

## 前提（コードを読んでも分からない決定事項）

### 状態管理

- Pinia は使わない。composables はモジュールレベルの singleton。新しい状態もこの形に合わせる
- `useSettings` は localStorage に自動永続化。APIキーだけは `lib/keyVault.ts`（IndexedDB + WebCrypto）で暗号化する

### データ

- `conversations.user_id` は `user_setting.id` への外部キー。会話作成の前に `ensureUserProfile()` が必須
- `error` ブロックだけ非永続化（DB の enum にも値が無い）。`text` と `perspective` は永続化する
- 本文と見解は**別々の insert** に分ける（`insertBlockRows`）。1配列だと PostgREST が単一トランザクションで走り、見解が弾かれると本文まで消える。本文の失敗は throw、見解の失敗はログのみ
- `sort_order` は blocks 配列の位置そのもの。`perspective` は `body_start` で `push` されるので本文の下に並ぶ
- 退会だけがバックエンド（`routes/account.ts`）にあるのは `auth.users` が service_role でしか消せないため。会話削除がフロント完結なのは RLS の範囲内で閉じるから

### 三体モード（検算方式）

- 主体には他の体の存在を一切知らせず、単体モードと同一のプロンプトで答えさせる。副体には「問い」と「主体の答え」だけを渡す（履歴も会話人格も渡さない）
- 統合方式（副体の見解を主体のプロンプトに注入）は測定の結果やめた。数値は `textService.ts` 冒頭のコメントと `docs/chat_see.log`
- 旧・統合方式のコード（`ROLE_SLOTS` / `buildSecondary*` / `buildSynthesisLayer`）は本番経路から外れているが残す。`scripts/experiment-synthesis.ts` が比較に使う。本番を変えるときは `buildReview*` 側だけ触る
- 検算に回す条件: 副体が1体以上 かつ `needsMultiBody()`（挨拶など割れない問いを弾く） かつ 答えが `REVIEW_MIN_CHARS`（120字）以上
- 副体は `Promise.allSettled`。全滅しても答えは揺らがず、カードが欠けるだけ。`body_done` は失敗時も必ず送る（送らないと球体が分裂したまま固まる）
- 「指摘が出たか」（`hasFinding`）の判定は backend の `hasReviewFinding()` 1箇所。読む側は本文の文字列を見ない

### 共有キー（無料枠）

- 個人 3回/日・全体 50回/日（`sharedKey.ts`）。全体枠は応答前に**予約**し、提供できなければ `finally` で返す。個人枠は「共有キーで完了した」ときだけ消費
- 上限到達でも `bodies` に Ollama があれば弾かず下の経路へ落とす
- 個人枠と全体枠の文言は必ず分ける。「体が未設定」と「無料枠を使い切った」も同じ表示にしない

### プロバイダー

- Ollama はネイティブ `/api/chat` を叩く（OpenAI 互換エンドポイントは `think:false` を無視して reasoning モデルの content が空になる）。一部モデルが吐く `</s>` 等の特殊トークンは捨てる
- 思考レベル 4 = `thinkingBudget: 8000`（Sonnet 系）。レベル 5 = Opus 用で `budget_tokens` が使えないため `type: 'adaptive'`
- OpenAI / DeepSeek は `createOpenAICompatClient` に一本化済み。Anthropic だけ共有ファクトリが無く、呼び出し箇所ごとに `new Anthropic()`（管理された負債として据え置き）
- エラー本文はプロバイダーがキーを echo back することがある。SSE・ログに出す前に必ず `sanitizeErrorMessage` を通す

### ルーティング / UI

- `/` はランディング、ログイン済みは `/new` へ。`/new` にいる間は直近会話への解決をしない
- `/terms` `/privacy` `/help` `/s/:token` に `requiresAuth` を付けない（未ログインで読めないと同意が成立せず、Google OAuth 審査も通らない。共有は未ログイン閲覧が存在理由）
- ライブリージョン（`useChatAnnouncer`）には `aiState` の変化と応答完成時だけを流す。ストリーミング中の本文は流さない

### 音声

- 誰が占有するかは `syncListening()`、いつ渡せるかは `lib/speechHandoff.ts`。`SpeechRecognition` は `abort()` しても `onend` まで手放さず、待たずに次を開くと新しい認識器が無言になる。認識器を作る側は `notifyStart` / `notifyEnd` を必ず通し、開く前に `waitForRelease()` を待つ
- 録音中にマイクを掴むのは `SpeechRecognition` だけ。音量バーや無音判定のために `getUserMedia` / `AudioContext` を足さない（iOS は2系統同時で認識側が沈黙する）。バーは認識結果の到着で動かし、無音判定は結果が更新されなくなってからの経過時間で行う
- 無音からの自動送信までの待ち時間は `lib/endpointing.ts` が決める。材料は認識文字列（言い切り / 言い淀み）と、その端末の結果到着間隔の実測値（`noteResultGap()`、UA で分岐しない）
- `TextComposer` は読み上げを起動しない。IME変換中の Enter は送信しない

### 環境変数

- `.env` にフロント（`VITE_`）とバック両方が同居する。`VITE_ORIGIN_BASE_URL` は接頭辞に反してバックエンドが CORS origin として読む（未設定だと全オリジン許可に落ちる）
- `OLLAMA_ENABLED` は未設定時 true。本番（Render）では false を明示する
- モデル変更は `*_MODEL_FAST` / `_BALANCED` / `_POWERFUL` の書き換えだけで完結させる。`modelConfig.ts` は非null断言で読むので、使うプロバイダーぶんは必ず埋める
- `render.yaml` はまだ Blueprint 未接続。ビルド / 起動コマンドを変えたらダッシュボード側も確認する

## 計測・検証スクリプト（`package.json` に無いもの）

- `THREEBODY_TOKEN=<Supabaseアクセストークン> node scripts/regress.mjs` — プロンプト回帰ハーネス。同じ問いを複数回投げて主体の本文だけを判定する（既定は Ollama 3体）
- `npx tsx scripts/preview-review.ts [model] ['問い']` — 認証もフロントも通さず `orchestrateMultiBody` を1往復動かし、検算の中身を読む
- `npx tsx scripts/experiment-synthesis.ts` — 統合方式との対照実験
- `node scripts/verify-share-rls.mjs` / `node scripts/view-shared.mjs` — 共有の RLS 検証 / 共有・検算の集計（service key）

## ドキュメント

- 設計判断・用語集・負債棚卸しは `docs/CONTENT.md` **1ファイル**に集約する。新しい md を作らない。`docs/adr/` も作らない。章番号（0章 / ①②③ / 2章）はコードコメントから参照されているので振り直さない。0章の原則は再検討しない。詳細: `docs/agents/domain.md`
- 用語は用語集の語を使う: **主体 / 副体 / 検算 / 見解 / 三体モード**。「プライマリ」「レビュアー」「統合」「レビュー結果」へ流れない
- Issue は GitHub Issues（`gh`）: `docs/agents/issue-tracker.md`。トリアージラベル: `docs/agents/triage-labels.md`
- `docs/build/log.md` はセッションの作業ログ（未コミットの変更・調査だけで終わったこと・次にやること）。区切りごとに日付を先頭に追記する

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
