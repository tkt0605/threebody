# ThreeBody 棚卸し（2026-08-06 時点）

現状のコードベース全体を読み、**足りない部分 / 未着手 / 削っていい部分** の3つに分けて整理する。

- 対象コミット: `74aa677`（main）
- 実測: `npm run test` → 8ファイル 52件 全通過 / `vue-tsc --noEmit`・`typecheck:backend` → エラーなし / `npm run lint` → **eslint 未インストールで実行不能**
- 規模: フロント 25ファイル・バックエンド 12ファイル、合計 約4,800行

3分類の境目は次のように置いた。

| 分類 | 定義 |
|---|---|
| 足りない部分 | 機能としては存在するが、穴・不整合・運用上の欠落がある |
| 未着手 | そもそも作られていない（ドキュメントだけ存在する場合を含む） |
| 削っていい部分 | 消しても誰も困らない死んだコード・資産・重複 |

---

## 1. 足りない部分

### 1.1 入力手段が音声しかない（最優先）

`src/views/ChatView.vue` にテキスト入力欄が存在しない。会話を始める手段は `VoiceSphere` のマイクだけで、`useVoiceInput` → Web Speech API に完全依存している。

- Web Speech API 非対応ブラウザ（Firefox、一部の Safari）では**アプリが何もできない**
- マイク権限を拒否した場合も同様
- さらに `useVoiceInput` は `errorMsg`（「このブラウザは音声認識に対応していません」「マイクへのアクセスが拒否されました」）を持っているのに、`ChatView.vue:76` の分割代入で受け取っておらず**画面に一切出ない**。ユーザーからは「球体を押しても何も起きない」としか見えない

→ 対応: テキスト入力欄の追加（後述 2.1 とセット）と、`errorMsg` の表示。少なくとも後者は数行で直る。

### 1.2 生成を中断できない

`useChat.ts:364` の `fetch` に `AbortController` が付いていない。リポジトリ全体で `abort` の参照はゼロ。

- Level 5 は `maxTokens: 32000`。長文生成に入ると止める手段がない
- 会話を切り替えても前のストリームは走り続け、`reactiveMsg` へ書き込みを続ける
- 共有キー利用時は、止められないまま1回分のクォータを消費する

### 1.3 DBスキーマがリポジトリに無い

Supabase 側の定義がコードに一切含まれていない。必要なもの:

- テーブル: `user_setting` / `conversations` / `messages` / `content_blocks` / `feedback`
- RPC: `consume_shared_quota`（`sharedKey.ts:96` が呼ぶ、原子的な加算の要）
- RLS ポリシーと列 GRANT（`can_use_shared_key` などを `authenticated` から取り上げる設定）

さらに `backend/src/supabaseAdmin.ts:6` のコメントは `docs/shared-key-migration.sql` を参照しているが、**このファイルは存在したことがない**（`git log --all -- '*.sql'` が空）。

→ 現状、リポジトリをクローンしても DB を再現できない。`docs/schema.sql` として起こすべき。

### 1.4 `.env.example` が無い

- `README.md:51` は「`.env`を新規作成し、APIキーを追加」としか書いておらず、必要な変数の一覧が無い（一覧があるのは `CLAUDE.md` だけ）
- `.devcontainer/devcontainer.json` の `postCreateCommand` は `.env.example` からのコピーを試みるが、ファイルが無いので毎回空の `.env` が作られる

### 1.5 lint が動かない / CI が無い

- `npm run lint` → `sh: eslint: command not found`。`eslint.config.js` は `ignores` だけでルールが1つも無く、仮に入れても何も検査しない
- `.github/` が存在せず、通っているテスト52件も型チェックも**自動では回らない**

### 1.6 思考レベル（Lv1〜5）にUIから到達できない

`SettingsDialog.vue:318-339` の思考レベル選択UIがコメントアウトされている。結果:

- `settings.thinkingLevel` は既定値の `3` から動かせない
- バックエンドの `LEVEL_CONFIG[4]`（`thinkingBudget: 8000`）と `LEVEL_CONFIG[5]`（`adaptive thinking`）は**到達不能なコード**になっている
- 定数 `THINKING_LEVELS`（`SettingsDialog.vue:50`）だけが宙に浮いている

→ 「Level 5 まである」はドキュメント上の話であって、現在のUIからは使えない。復活させるか、レベル自体を畳むかの判断が要る。

### 1.7 副体が1つ落ちると全体が失敗する

`server.ts:441` の `Promise.all` は、副体1体が throw した時点で reject する。

```
二体（OpenAI: キー失効） → throw
  ↓
Promise.all が reject → catch → error イベント
  ↓
三体の見解も、一体による統合も、まるごと失われる
```

三体モードの売りは「複数視点の統合」なので、1体の失敗で全滅するのは設計と噛み合っていない。`Promise.allSettled` にして、失敗した体は見解から除外して統合を続けるのが妥当。

### 1.8 会話履歴を毎回まるごと送っている

`useChat.ts:368` の `toApiMessages(messages.value.slice(0, -1))` は全履歴を送る。切り詰めも要約もない。

- 長い会話ほど入力トークンが線形に増え、コストとレイテンシが伸びる
- 三体モードでは副体2体＋主体で**同じ履歴を3回**送ることになる
- 最終的にはモデルのコンテキスト上限に当たって落ちる（そのときのエラーは生のプロバイダーメッセージのまま出る）

### 1.9 テストが薄い領域

| 領域 | テスト |
|---|---|
| `backend/src/server.ts`（555行・三体モードの中核） | **0件** |
| Vue コンポーネント（10ファイル） | **0件** |
| `useSettings` / `keyVault`（APIキーの暗号化・移行） | **0件** |
| `useChat` | 8件（SSE分岐とエラー分類のみ。三体モードの `body_start`/`body_text`/`body_done` は未検証） |
| 小さな純関数（`redact` / `auth` / `jstDate` / `errorSanitize` / `sharedKey` / `ollama`） | 44件 |

テストは「切り出した純関数」に集中していて、**壊れたら一番痛い場所（server.ts の三体オーケストレーション）が無防備**。

### 1.10 `/api/chat` が無認証で叩ける

認証は共有キーの割当判定にしか使われず（`server.ts:372`、意図的な設計）、防御は IP あたり 5分15回のレート制限だけ。BYOK を名乗れば誰でも運営のバックエンドを LLM プロキシとして利用できる。共有キーは認証必須なのでコスト流出は無いが、帯域と可用性は運営持ちになる。

### 1.11 UI が日本語ハードコード

`settings.language` は LLM の応答言語（`useSystemPrompt.ts` の `LANGUAGE_PROMPT`）と音声認識のロケールにしか効かない。UI 文言はすべて日本語直書きで、`README.en.md` があるのに英語UIは無い。

### 1.12 モデル名が手入力

`SettingsDialog.vue:29-34` はプレースホルダ（`例: gpt-4o`）頼み。タイポは送信して初めてプロバイダーのエラーとして返る。Ollama の `/api/tags` も未使用で、ローカルに何が入っているか分からない。

---

## 2. 未着手

### 2.1 テキスト入力とキーボード操作

1.1 の裏返し。「声で完結する」はコンセプトとして正しくても、実装として**代替経路が用意されていない**。

### 2.2 MCP

`CLAUDE.md` の「主要コンポーネント」に `McpDialog.vue` / `McpPanel.vue`（現状UIのみ、バックエンド未連携）と書かれているが、**両ファイルとも存在しない**。UI も含めて完全に未着手。

### 2.3 三角形UI（コンセプトと実装の乖離）

`CLAUDE.md` は `NodeCanvas.vue`（三角形のドラッグ配置キャンバス）と `useTriangleNodes.ts` を実在するものとして記載し、`README.md` も「1〜3つのノードを三角形に配置し、その重心で音声チャットを行う」と書いているが、どちらのファイルも削除済み。現在のUIは単一の球体で、三角形は `EmptyBrainState.vue` の泣き顔SVGにしか残っていない。

→ 「三角形を作り直す」か「コンセプト文を現状に合わせる」かの決断が要る。**放置すると、ドキュメントが一番の嘘つきになる。**

### 2.4 マルチモーダル（画像・ファイル添付）

`README` / `CLAUDE.md` は「マルチモーダルAI体験」を掲げるが、扱えるのはテキストと音声のみ。`ContentBlock` も `text` / `error` / `perspective` の3種類だけ。

### 2.5 会話の検索・エクスポート・共有

一覧・切替・リネーム・削除まで。会話が増えると `AppAside` のリストを目視で探すことになる。

### 2.6 共有キーの招待フロー

`can_use_shared_key` を運営が手動で DB 更新する運用（README にも「招待制」と明記）。申請UI も管理画面も無い。ユーザー側からは `not_permitted` という結果しか見えず、次に何をすればいいか分からない。

### 2.7 `feedback` テーブルの受け側

`useFeedback.reportError()` は書き込むだけ。閲覧・集計・通知の手段が無いため、**報告が届いているかどうかを運営が知る術がない**。

### 2.8 使用量・コストの可視化

見えるのは共有キーの残回数だけ。自分のキーで使ったトークン量・概算コストは表示されない。

### 2.9 中断された応答の復旧

リロードすると生成中の応答は失われる。`isOrphaned`（`MessageList.vue:22`）で検出して「もう一度送信」を出すところまでで、途中まで生成されたテキストは復元しない。

### 2.10 バックエンドのデプロイ定義

`vercel.json` はフロントの SPA rewrite のみ。Render 側の設定（起動コマンド、環境変数、ヘルスチェック）はリポジトリ外にあり、コードから再現できない。

### 2.11 E2E テストとブラウザ互換の検証

Playwright 等の E2E は無し。1.1 のブラウザ依存を考えると、対応ブラウザの明文化だけでも価値がある。

---

## 3. 削っていい部分

### 3.1 `public/models/` の face-api モデル（約12MB）— 最優先

```
face_landmark_68_model-shard1        349KB
face_recognition_model-shard1/2      6.1MB
ssd_mobilenetv1_model-shard1/2       5.4MB
+ manifest 3件
```

顔認識モデル一式が **git に追跡されている**が、`face-api` は `package.json` に無く、コード中の参照もゼロ。リポジトリ全体で 81 ファイル中の 8 ファイルがこれで、クローンサイズの大半を占める。

→ `git rm -r public/models`

### 3.2 到達不能な単体モード経路

`settings.provider` は既定の `'ollama'` から変える UI が無い（`SettingsDialog.vue` の `draft.provider` は代入されるだけで、対応するUIも `save()` での書き戻しも無い）。そのため以下が実質デッド:

- `server.ts:488-502` の単体モード分岐（anthropic / openai / deepseek）
- `useChat.ts:379-380` のトップレベル `model` / `apiKey` 送信
- `Settings.provider` 型と `Provider` 型

→ 三体モード（`bodies` 配列）の経路に一本化できる。`bodies` は1体でも `available.length === 1` の分岐で動く。

### 3.3 コメントアウトされたコード

| 場所 | 内容 |
|---|---|
| `SettingsDialog.vue:318-339` | 思考レベルUI（1.6 の判断待ち。使わないなら `THINKING_LEVELS` 定数ごと削除） |
| `server.ts:133-136` | 旧エラーハンドリング（直下に改良版がある） |
| `MessageList.vue:30` | 旧 `div` の class |

### 3.4 未使用のエクスポート・props

- `useCapabilities.ts:29` の `loaded` — 「初回フェッチ前」と「取得後 allowed:false」を区別する意図だが、どこからも参照されていない
- `AppAside.vue:9` / `AppHeader.vue:6` の `defineProps<{ size?: number | string }>()` — 両方とも未使用

### 3.5 デバッグ用 `console.log`

- `AppAside.vue:29,33`（`'Logging out...'` / `'Logged out and redirected to login page'`）
- `useAuth.ts:34`（`'Logged out'`）

### 3.6 リポジトリ直下の作業ファイル

`.gitignore` 済みで追跡はされていないが、作業ディレクトリに残っているもの:

- `2026_07_29Threebodyデモ動画.mov`（13MB）— README が使うのは GIF の方
- `git-push.txt` / `.DS_Store` / `dist/`

### 3.7 `.devcontainer` の陳腐化した設定

- `forwardPorts` が `5174` だが Vite は `5173`（`npm run dev`）
- 推奨拡張に eslint / prettier を指定しているが、どちらも依存に無い
- `postStartCommand` は `echo` するだけ

→ devcontainer を実際に使っていないなら丸ごと削除、使うなら 1.4・1.5 とセットで直す。

### 3.8 `CLAUDE.md` の古い記述

存在しないファイル・機能を指している箇所:

- 「`NodeCanvas.vue` — 三角形のドラッグ配置キャンバス」→ 削除済み
- 「`McpDialog.vue` / `McpPanel.vue`」→ 存在しない
- 「`useTriangleNodes.ts` — `placedNodes` を module-level ref として保持」→ 削除済み
- 「`AppAside.vue` — 会話一覧（切替・**リネーム**・削除）」→ リネームUIは `AppHeader.vue` 側
- 「録音中はウェイクワード検知を停止（`ChatView.vue:41`）」→ 実際は `ChatView.vue:91`

### 3.9 `docs/product-improvement-plan.md`（ローカルで削除済み・未コミット）

「Steve Jobs批評」への対応プランだが、内容の大半は**すでに実施済み**:

- persona 化（`bodyPersonas.ts` / `buildBodyPersonaPrompt` / per-body の `personaPrompt` 送信）→ 完了
- デッドコード7ファイル（`NodeCanvas` 等）の削除 → 完了
- `uuid` / `readline` の依存削除 → 完了
- `.DS_Store` の `.gitignore` 追加 → 完了

未実施のまま残っているのは「simple / advanced モードの分離」と「意思決定モードのプリセット」の2点だけ。削除して本ドキュメントに置き換えるのが自然（残す価値があるのはこの2点なので、必要なら 2.x へ移す）。

### 3.10 `messages.content` と `content_blocks` の二重保存

`persistMessage`（`useChat.ts:295-314`）は本文を `messages.content` に入れ、同じ内容を `content_blocks.payload.content` にも入れている。読み出し（`fetchMessages`）は `content_blocks` しか見ない。`content` は現状どこからも読まれていない。

---

## 4. 着手順の目安

| # | 項目 | 分類 | 効果 / コスト |
|---|---|---|---|
| 1 | `public/models/` 削除 | 削る | 12MB 減 / 1コマンド |
| 2 | `useVoiceInput.errorMsg` の表示 | 足りない | 「無反応」の解消 / 数行 |
| 3 | テキスト入力欄の追加 | 未着手 | 対応ブラウザが一気に広がる / 中 |
| 4 | `Promise.all` → `allSettled` | 足りない | 三体モードの堅牢性 / 小 |
| 5 | `AbortController` で中断 | 足りない | コスト制御とUX / 小〜中 |
| 6 | `docs/schema.sql` を起こす | 足りない | 再現性・引き継ぎ / 中 |
| 7 | eslint 導入 + GitHub Actions | 足りない | 52件のテストが初めて機能する / 小 |
| 8 | 思考レベルUIの復活 or 撤去 | 足りない/削る | Lv4-5 の死蔵を解消 / 小 |
| 9 | `CLAUDE.md` の実態合わせ | 削る | ドキュメントの信頼回復 / 小 |
| 10 | 単体モード経路の削除 | 削る | server.ts の分岐が1本減る / 小 |
