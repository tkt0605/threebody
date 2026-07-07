# ThreeBody 改善プラン

「Steve Jobs批評」で指摘された3点への対応案と、現状コードベースの棚卸し（蛇足・未実装部分の洗い出し）をまとめる。

## 1. 改善提案

### 1.1 3体のアイデンティティ設計

現状、3体は `provider`（Ollama/OpenAI/Anthropic/DeepSeek）というプロバイダー名でしかラベル付けされていない（`src/constants/bodyProviders.ts` の `BODY_PROVIDER_COLORS`）。役割としての人格が存在しない。

- [ ] `BodyConfig`（`src/composables/useSettings.ts`）に `role: 'optimist' | 'skeptic' | 'realist'` のような役割フィールドを追加。providerとは独立させる。
- [ ] `src/constants/bodyPersonas.ts` を新設し、role ごとの `name`（例:「楽観主義者」）・`personaPrompt`（性格・視点の指示文）・色を定義する。
- [ ] `src/composables/useSystemPrompt.ts` に `buildBodyPersonaPrompt(role)` を追加し、`BASE_PERSONA` に役割固有の性格レイヤーを重ねる。
- [ ] `backend/src/server.ts` の `streamSecondaryBody()` は現在すべての副体に同一の `systemPrompt` を渡している（`server.ts:306` 付近）。per-bodyでpersona差分を渡せるように変更する。
- [ ] `server.ts` の `BODY_NAMES = ['一体','二体','三体']`（連番ラベル）を廃止し、フロントから渡されたpersona名を使う。
- [ ] `MessageBubble.vue` / perspectiveブロックの表示を「provider名」→「persona名」に切替（`BodyPerspective.provider` はメタデータとしてのみ残す）。

### 1.2 配管の隠蔽

プロバイダードロップダウン・APIキー欄・モデル名（`gpt-4o`等）が、そのままユーザー向け設定画面に露出している（`SettingsDialog.vue`）。

- [ ] `useSettings.ts` に `mode: 'simple' | 'advanced'` を追加。デフォルトは `simple`。
- [ ] simpleモードでは provider/apiKey/model欄を隠し、「1体（速い）」「3体（評議会）」の1スイッチのみを見せる（`SettingsDialog.vue` の該当ブロックを `v-if="draft.mode === 'advanced'"` で分離）。
- [ ] simpleモードの既定値をOllamaローカルモデルにし、APIキー入力ゼロで三体モードが動く状態を保証する（`DEFAULT_BODIES` の見直し）。
- [ ] advancedモードは既存のプロバイダー/APIキー/モデル入力をそのまま残す（削除はしない、開発者・パワーユーザー向けの抜け道として維持）。
- [ ] チャット画面上のprovider露出も削除し、1.1のpersona名表示に統一する。

### 1.3 単一ユースケースへの絞り込み

現状「三角形にLLMを配置して話す」という汎用アーキテクチャのみで、旗艦シナリオが存在しない。

- [ ] 新プリセット「意思決定モード」を追加（`Preset` 型 / `PRESET_EXTRA` in `useSystemPrompt.ts`）。1.1のoptimist/skeptic/realist personaと直結させる。
- [ ] `server.ts` の `synthesisSystemPrompt`（現在は汎用的な「見解を踏まえて統合回答を」）を「楽観主義者・懐疑主義者・現実主義者の意見を踏まえ、決断のための結論を提示してください」に専用化。
- [ ] 初回起動時のオンボーディングを決断相談に固定する（空の三角形+汎用設定ダイアログではなく、「今、悩んでいる決断は？」を最初に問う導線）。
- [ ] coding/creative/chatプリセットはadvancedモード配下に格下げし、トップレベルの選択肢として同列に見せない。

## 2. 削るべき部分（蛇足・未実装の棚卸し）

`grep`でコードベース全体の参照関係を確認した実測結果。

### 2.1 デッドコード（実装済みだが、どこからも参照されていない）

現行のルーティングは `App.vue` → `RouterView` → `ChatView.vue` が `AppAside.vue` / `AppHeader.vue` / `AppRightSidebar.vue` / `MessageList.vue` を組み合わせる構成。以下は、ルーターへの移行（三角形UIの前身版）以前に作られ、置き換え後も残っている未参照ファイル：

| ファイル | 状態 |
|---|---|
| `src/components/NodeCanvas.vue` | プロジェクト内どこからもimportされていない。三角形UIの旧版そのもの |
| `src/components/ChatDialog.vue` | `NodeCanvas.vue` からのみ参照 → NodeCanvasが死んでいるため実質デッド |
| `src/components/PathDialog.vue` | どこからもimportされていない |
| `src/components/ChatPanel.vue` | どこからもimportされていない |
| `src/components/TriangleNav.vue` | どこからもimportされていない |
| `src/components/McpPanel.vue` | どこからもimportされていない（実際に使われているのは`McpDialog.vue`） |
| `src/composables/useTriangleNodes.ts` | `NodeCanvas.vue` 専用 → 実質デッド。ただし `useTriangleNodes.test.ts` が現在も存在し、死んだコードをテストし続けている |

→ **対応**: 上記7ファイル（+対応テスト）を削除する。`NodeCanvas.vue` に付随する `useTheme` / `ContextDialog` / `McpDialog` の呼び出しは他のコンポーネントからも使われているため、削除の際はそれらが引き続き `ChatView.vue` 系統から参照されていることを確認する。

### 2.2 未使用の依存パッケージ（`package.json`）

- `readline` — コード内で一切使われていない
- `uuid` — 未使用（`useChat.ts` は `crypto.randomUUID()` を使用しており不要）

→ **対応**: `npm uninstall readline uuid` で依存を削除。

### 2.3 型はあるが実装がない機能

- `ImageBlock` / `MapBlock` / `GameBlock`（`src/types/message.ts`）— 型定義のみで、送信ロジック・描画ロジックのどちらも存在しない
- MCP関連（`McpDialog.vue` / `settings.mcpServers`）— UIのトグルはあるが、バックエンド連携が一切ない。オン/オフの状態が`localStorage`に保存されるだけで、`/api/chat` 等どのエンドポイントにも渡っていない

→ **対応**: 実装予定がないなら型・UIごと削除。実装するなら、まず1.3の「単一ユースケース」に寄与するかを判断してから着手する（現状はどちらの機能もロードマップに乗っていない）。

### 2.4 リポジトリの雑多なファイル

- `.DS_Store` — Gitで**追跡されている**（`.gitignore`に`.DS_Store`の記載がない）。誤コミット防止のため`.gitignore`に追加し、`git rm --cached .DS_Store`で追跡解除すべき
- ルート直下のスクリーンショット3枚（`スクリーンショット 2026-07-05 *.png`）— `*.png`が`.gitignore`対象のため追跡はされていないが、作業ディレクトリに残ったままでREADME等からもリンクされていない。用途が終わっていれば削除
- `threebody_demo_withAPI2.gif` — READMEからリンクされている唯一のメディアなので、これは残す
