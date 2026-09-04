# CLAUDE.md

ThreeBody — 1〜3個のLLM（「体」）が並列に回答し、主体（一体）が統合する音声チャット。Vue 3 + Express、SSEストリーミング。

## 構成

- 永続化 — Supabase `conversations` → `messages` → `content_blocks`。クエリは `useChat.ts` に集約

ファイル単位の説明はここに書かない。必要なら実物を読むこと。

## 前提（コードを読んでも分からない決定事項）

### 状態管理

- Pinia は使わない。composables はモジュールレベルの singleton（`ref` / `reactive` をモジュールスコープに置く）。新しい状態を足すときもこの形式に合わせる
- `useSettings` は localStorage に自動永続化。APIキーだけは平文にせず `lib/keyVault.ts` で暗号化する

### データ

- `conversations.user_id` は `user_setting.id` への外部キー。会話作成の前に `ensureUserProfile()` が必須
- `error` ブロックだけ非永続化（表示専用で DB の enum にも値が無い）。`text` と `perspective` は永続化する
- 本文と見解は別々の insert に分ける。1配列で送ると PostgREST が単一トランザクションで走り、見解が弾かれた瞬間に本文まで巻き添えで落ちる
- 退会だけがバックエンドにあるのは、`auth.users` の行が service_role でしか消せないため。会話削除がフロント完結なのは RLS の範囲内で閉じる操作だから

### 三体モード（検算方式）

- 主体が先に答え、その答えを副体があとから検算する。主体には他の体の存在を一切知らせず、単体モードとまったく同じプロンプトで答えさせる
- 統合方式（副体の見解を主体のシステムプロンプトへ注入して統合させる）は測定の結果やめた。入る観点より落ちる観点のほうが多かった。経緯と数値は `docs/chat_see.log`
- 旧・統合方式のコード（`ROLE_SLOTS` / `buildSecondary*` / `buildSynthesisLayer`）は本番経路から外れているが残してある。`scripts/experiment-synthesis.ts` が方式間の比較に使う。本番の挙動を変えるときは `buildReview*` 側を触ること
- SSE イベント順: `answer_start` → `text` → `answer_done`（`review` で検算の有無を伝える）→ `body_start` / `body_text` / `body_done`
- `aiState` の遷移: `idle → thinking → converging → reviewing → idle`。`answer_done` の時点で本文は完成しているので、読み上げは検算の完了を待たない
- 検算に回すのは、副体が1体以上あり、割れる余地のある問い（`needsMultiBody`）で、答えが 120 字以上のときだけ
- 副体が全滅しても答えは揺らがない。カードが欠けるだけ（統合方式では副体の失敗が答えそのものを揺らしていた）
- 見解カードは本文の下に並ぶ。`sort_order` は blocks 配列の位置そのもので、`perspective` は `body_start` で `push` される

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
- 誰が占有するかは `syncListening()` が決めるが、いつ渡せるかは `lib/speechHandoff.ts` が決める。`SpeechRecognition` は `abort()` しても `onend` が返るまで手放さず、待たずに次を開くと新しい認識器が無言のまま音を拾わない。認識器を作る側は `notifyStart` / `notifyEnd` を必ず通し、開く前に `waitForRelease()` を待つ
- 録音中にマイクを掴むのは `SpeechRecognition` だけ。音量バーや無音判定のために `getUserMedia` / `AudioContext` を足さない。iOS（Safari も Chrome も WebKit）では2系統の音声取得を同時に持つと認識側が無言になる。バーは認識結果の到着で動かす演出、無音判定は結果が更新されなくなってからの経過時間で行う
- `TextComposer` は読み上げを起動しない（文字で打った人に音声を返さない）。IME変換中の Enter は送信しない
- 無音からの自動送信までの待ち時間は固定値ではなく `lib/endpointing.ts` が決める。材料は2つで、認識文字列（言い切ったか / 言い淀んでいるか）と、その端末が結果と結果の間に空ける実測幅。後者は UA で分岐せず `noteResultGap()` が観測して持ち越す（PC Chrome は 0.26 秒、iOS Chrome は発話中でも 1.4 秒空く）

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

## Agent skills

### Issue tracker

GitHub Issues（`gh` CLI）。See `docs/agents/issue-tracker.md`.

### Triage labels

デフォルトの5ラベル (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`)。See `docs/agents/triage-labels.md`.

### Domain docs

`docs/CONTENT.md`（設計判断/用語集/負債棚卸しの3セクション。ROADMAP.mdは廃止・統合済み）。See `docs/agents/domain.md`.