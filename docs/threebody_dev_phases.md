# ThreeBody 開発フェーズまとめ

作成日: 2026-08-06 / 最終更新: 2026-08-15
前提資料: [mulmo-series-analysis-20260806.md](./mulmo-series-analysis-20260806.md) / [threebody-mulmo-alignment-20260806.md](./threebody-mulmo-alignment-20260806.md)
公開判定とユーザー数別の優先順位: [public-release-readiness-20260814.md](./public-release-readiness-20260814.md)

## 前提（両文書の関係）

- **mulmo-series-analysis** — 中嶋聡さんの3プロジェクト（MulmoChat/MulmoClaude/MulmoTerminal）の共通思想を抽出：LLM=汎用OS、データ主権、エージェント監督
- **alignment文書** — その思想とThreeBodyの現状を突き合わせ、「音声対話ファースト」を主軸に据えた上で、**音声3本柱（柱A/B/C）× 一体型移行（Apple I→II）を1本の順序に統合**したのがPhase 0〜6

---

## 到達点：LLM OS（2026-08-15 決定・確定事項）

**ThreeBody の到達点は LLM OS である。これは決定であり、以降の検討対象ではない。**
Phase 0〜6 は「そこへ至るための順序」であって、別方向の開発計画ではない。

### 何を作るのか

中島聡さんの `LLM_OS.md` が示す **Application-centric → Intent-centric** の転換を、
「一人の人間が毎日使う OS」として実装する。

```text
ユーザー → 意図を表明 → LLMが理解 → Capabilityを組み合わせる → 必要なUIを生成 → 結果
```

ThreeBody 固有のテーマは、その意図処理を**単一の知性ではなく複数の視点で行い、
その過程が見えて聞こえる**こと。これは他のどのLLM OS構想にも無い。

### 3層モデル

| 層 | 役割 | 現状 |
|---|---|---|
| **Layer 1 — LLM** | 考える（Anthropic / OpenAI / DeepSeek / Ollama） | 実装済み（`backend/llm/providers/`） |
| **Layer 2 — ThreeBody Runtime** | 理解する・判断する・組み合わせる・実行する | **Perspective と Synthesis のみ実装済み。Capability 以降が未着手** |
| **Layer 3 — Computer** | 世界を動かす（Browser / Files / Terminal / Network） | 未着手（Phase 5 の MCP が入口） |

**LLM は「脳」、ThreeBody Runtime は「神経系」**という位置づけ。
LLM を kernel そのものに置き換えるのではなく、intent orchestrator として使う。

### すでに持っている資産（新規に作る必要が無いもの）

「Perspective Engine を追加する」という構想は、実体としては**もう動いている**。

| 構想上の名前 | 実装 |
|---|---|
| Perspective の定義 | `src/constants/bodyPersonas.ts`（`optimist` / `skeptic` / `realist`） |
| Perspective の注入 | `useSystemPrompt.ts:102` `buildBodyPersonaPrompt()` → `BodyConfig.personaPrompt`（`llm/types.ts:10`） |
| 並列な視点処理 | `llm/textService.ts` `orchestrateMultiBody()` / `streamSecondaryBody()` |
| Synthesis → Decision | 主体（一体）による統合回答（`synthesis_start` → `text`） |
| 過程の可視化 | `VoiceSphere.vue`（体の数だけ粒子クラスタに分裂）＋ `useVoiceNarration`（相槌・逐次TTS） |

`BodyPersona` は provider と直交しているため、**モデルが入れ替わっても ThreeBody は残る**。
「三体＝固定の3モデル」ではなく「3つの異なる知性・役割の協調」という抽象化は、
思想としてだけでなくコードの事実として既に成立している。
新しい視点（例：`visionary`）の追加は union 型への1行追加で済み、新レイヤーを要さない。

### 到達までの順序

Layer 2 の残り（Capability / Planning / Execution / Permission / Verification）を
**抽象層として先に設計しない**。理由は2つ。

1. **抽象化する対象がまだ1個も無い** — 現在の Capability は「LLMと喋る」だけで、外部ツール実行の口は0件。実装が1個の段階で括り出すと、その1個の形に合わせた棚ができるだけで、2個目で作り直しになる
2. **今の律速はアーキテクチャではなく資金** — 全体枠 50回/日 で デイリーアクティブ30〜50人が上限。抽象層を作っても31人目は使えないままで、広げる原資は課金からしか出ない

したがって順序は以下で固定する。

| # | やること | 意味 |
|---|---|---|
| **1** | **Phase 2 の残り1件**（確認ステップの音声化） | 声だけで一往復が閉じる |
| **2** | **Phase 3（初回体験）→ Phase 4（課金）** | 資金の壁を越える。ここを越えないと Layer 2 を作る時間が買えない |
| **3** | **Phase 5：MCP を1本だけ繋ぐ** | 実物の Capability 第1号。**Registry は作らない、ベタ書きでよい** |
| **4** | **MCP が2本目・3本目になった時点で共通部分を括り出す** | それが自然に `Capability Registry` になる |

> **抽象層は設計するものではなく、具体が3つ並んだときに「同じだ」と気づいて括り出すもの。**
> ロードマップの Phase 5 は最初からその位置にあるため、既存の順序を変更する必要は無い。

---

## 達成状況（2026-08-15 時点）

git log と実コードで裏を取った現在地。**進捗はこの節を正本とする。**

> **2026-08-14 の再確認** — `e39907f` 以降にコミットは無く、下記の未達成項目を実コードで1件ずつ
> 再検証した。テストは136件パス。**Phase 2 の残りは「確認ステップの音声化」1件のみ**。
> 一般公開の可否という別軸での判定は [public-release-readiness-20260814.md](./public-release-readiness-20260814.md) に分離した。

### 達成済み

| 項目 | 出所 | 裏付けコミット |
|---|---|---|
| Phase 0：共有キー経路を三体モードに | ロードマップ | `8088f02` `98c651f` `c614cfd` `1c36512` `6c085a7` |
| Phase 1 Step 1：行が無ければ自動作成 | ロードマップ | `51c8517` |
| Phase 1 Step 2：全体日次上限（50回/日） | ロードマップ | `92bccda` `2493cbf` |
| Phase 1 Step 3：招待制の反転 | ロードマップ | `c092537` `8bd21ba` |
| Supabase へのマイグレーション適用（`schema.sql` 6章 A・B） | ロードマップ | 2026-08-11 適用完了 → **Phase 1 完了** |
| 共有キー判定のログ出力（誰が・なぜ弾かれたか） | 運用要望 | `5ff3fbe` `8b33e73` `d8a14dc` |
| `Promise.all` → `allSettled`（副体1体の失敗で全滅しない） | 棚卸し 1.7 | `a89a265` |
| `errorMsg` の画面表示（マイク拒否時の「無反応」解消） | 棚卸し 1.1 | `9c452f1` |
| `AbortController` による生成中断 | 棚卸し 1.2 | `9c452f1` |
| 三体オーケストレーションのテスト（0件 → 5件） | 棚卸し 1.9（一部） | `a89a265` |
| `CLAUDE.md` の実態合わせ | 棚卸し 3.8 | `accdd69`（本セッション前に完了済み） |
| 外部レビュー12項目の事実確認 | — | `8195f98` |
| コードブロックのライト/ダーク配色分離 | UI要望 | 最新 |
| CI（lint・型チェック2種・テスト）の新設 | 棚卸し 1.5 | `78454e3` `157a91c` |
| 会話履歴の切り詰め（直近10件） | 棚卸し 1.8 | `02b60b7` |
| `.env.example` の新設 | 棚卸し 1.4 | `e02b107` |
| `/api/chat` の認証必須化 | 棚卸し 1.10 / 外部レビュー #1 | `50d8c7b` |
| デプロイ定義のリポジトリ化（`render.yaml`） | 棚卸し 2.10 | `9fe6d2c` |
| **`stopGeneration` のUI配線** | 棚卸し 1.2 の残り | 2026-08-12 |
| **ストリーミング出力の `aria-live`** | 外部レビュー #12 | 2026-08-12 |
| **`echoCancellation` の明示** | 外部レビュー #6 | 2026-08-12 |
| 思考レベルUI（Lv1〜5）の実装 | 棚卸し 1.6 | `SettingsDialog.vue:165-181`（2026-08-14 確認） |
| `public/models/` の face-api モデル削除（約12MB） | 棚卸し 3.1 | 削除済み（2026-08-14 確認） |
| テキスト入力（Web Speech API 非対応ブラウザの行き止まり解消） | 棚卸し 1.1「最優先」／外部レビュー #11 | `3dc1782`（`TextComposer.vue`） |
| 利用規約・プライバシーポリシー | 公開判定 | `3dc1782`（`LegalPage.vue` / `/terms` / `/privacy`） |
| 退会（アカウントと全データの削除、service_role・1時間5回まで） | 公開判定 | `d2be46e`（`DELETE /api/account` / `DeleteAccountDialog.vue`） |
| `release_global_quota`（schema.sql 6章ブロックC）の適用 | 2026-08-11 起票 | 2026-08-15 適用完了 |

### 対応不要（外部レビューの指摘が誤りだったもの）

| 指摘 | 実態 |
|---|---|
| #2 レート制限がサーバー側に無い | IP単位のrate-limit + DB/RPCによる原子的クォータが実装済み |
| #3 APIキーがlocalStorageに平文 | `keyVault.ts` でAES-GCM暗号化、鍵は非exportableでIndexedDB保持 |
| #10 三体モードがデフォルトON | キー未設定ユーザーは実質OFF（共有キー枠のみPhase 0で意図的にON） |
| #11 `NodeCanvas.vue` がポインタ必須 | 同ファイルは削除済み。**ただし同じ欠陥が `VoiceSphere.vue` に現存** → 未達成側に計上 |

### 未達成

**基盤**

- UIの日本語ハードコード（棚卸し 1.11）／モデル名が手入力（1.12、`SettingsDialog.vue:330`）
- `messages.content` と `content_blocks` の二重保存（3.10）／E2E・ブラウザ互換の検証が無い（2.11）。Vueコンポーネントのテストも依然0件
- 中断した応答は永続化されないため、リロードすると消える（ユーザー発言だけが残り「もう一度送信」導線になる）
- `feedback` テーブルの受け側（棚卸し 2.7）— `useFeedback.ts` は insert のみで、エラー報告が届いても運営が気づけない

**トラックA：音声（Phase 2）— 残り1件**

- **確認ステップの音声化** — `useVoiceInput.ts:180-211` の `confirming` / `confirmText` を閉じるのに今も画面のタップが要り（`ChatView.vue:296` / `VoiceSphereDialog.vue:55` のボタン）、ハンズフリーの理念と矛盾している。**Phase 2 の完了条件はここだけ**
- ASRの抽象レイヤ化（Web Speech API はFirefox非対応、Chromeでは音声がGoogleへ送られデータ主権と矛盾）
- ウェイクワードを軽量な専用エンジンへ（現状はフルASRの文字列マッチ）

**トラックB：アクセシビリティ**

- `VoiceSphere` のキーボード操作（#11）— `tabindex` / `@keydown` ともに0件
- 抽象入力イベント層（選択/確定/取消/移動）

**トラックC：確信度**

- モデル間の一致度の構造化抽出（#8）
- 状態モデル・候補生成（#9）

**Phase 3以降** — 初回体験 / 定額課金 / MCP / マルチモーダル

### 本セッションで判明した新規の負債

| 内容 | 場所 |
|---|---|
| `orchestrateMultiBody` は `available` の要素が `allBodies` と同一参照でないと `bodyIndex` が `-1` になる | `backend/llm/textService.ts` |
| `providers/anthropic.ts` はモジュール読込時に `new Anthropic()` するため、jsdom環境のテストではモック必須 | `backend/llm/providers/anthropic.ts` |
| ~~全体クォータは予約時に消費されるため、LLM失敗時も枠が減る~~ → **解消**（下記） | `backend/sharedKey.ts` |

### 2026-08-11 追加分（共有キーの枠まわり）

| 内容 | 状態 |
|---|---|
| `/api/capabilities` が予約側を呼んでおり、ページを開くだけで全体枠が減っていた | 解消。`peekSharedAllowance`（判定のみ）と `reserveSharedAllowance`（判定＋予約）に分割 |
| `limit_reached` が個人枠と全体枠で同じ値だった（未使用のユーザーに「3回まで使いました」と表示） | 解消。`global_limit_reached` を新設し、SSE・UI・ダイアログの文言を分離 |
| 予約した全体枠が失敗時に戻らない | 解消。`release_global_quota` RPC と `releaseGlobalQuota()` を新設し、`routes/chat.ts` の finally で「共有キーで提供できなかったとき」だけ返す |
| `/api/capabilities`・`/api/chat` にルートテストが無い | 解消。`backend/tests/capabilitiesRoute.test.ts` / `chatRoute.test.ts`（依存追加なしで express を ephemeral port に立てて叩く） |

**適用済み（2026-08-15 確認）** — `docs/schema.sql` 6章の**ブロックC**（`release_global_quota`）は
Supabase へ適用完了。失敗したぶんの全体枠は返却される。

### 2026-08-12 追加分（停止・読み上げ・マイク）

| 内容 | 状態 |
|---|---|
| `stopGeneration` に呼び出し元が無く、生成を止める手段が実質存在しなかった | 解消。`StopButton.vue` を新設し、中央の球体・会話ログ下部・音声ダイアログの3箇所に配線 |
| 停止すると発言者名だけの空バブルが残り、送り直す導線も出なかった | 解消。`cancelGeneration()` を新設（中断＋空の応答メッセージの除去）。`stopGeneration` は送信直前の自己中断にも使うため分離した |
| 停止してもTTSが読み上げ続ける | 解消。`handleStop` で `voiceActive` を落としてから中断し、`cancel()` で読み上げも止める |
| ストリーミング出力がスクリーンリーダーに届かない（#12） | 解消。`ChatLiveRegion.vue` + `useChatAnnouncer.ts` を新設し、状態変化と完成した応答だけを `role="status" aria-live="polite"` で流す |
| `echoCancellation` 未指定（#6） | 解消。`useVoiceInput.ts` の `getUserMedia` に `echoCancellation` / `noiseSuppression` / `autoGainControl` を明示 |

**設計判断** — 本文DOMそのものを `aria-live` にはしていない。ストリーミング中は1トークンごとに
書き換わるため、そこをライブリージョンにすると更新のたびに全文が読み直され、かえって
聞き取れなくなる。会話ログ側は `role="log"` + `aria-live="off"` + `aria-busy` にとどめ、
読み上げは `ChatLiveRegion` に一本化した。

### 2026-08-12 追加分その2（Phase 2：沈黙を消す）

**方針決定：C（球体＋相槌で埋める）を採用。** A（主体先行）は `orchestrateMultiBody` の
2ラウンド構造そのものと「統合回答」という三体の意味論を作り替える必要があり、
B（音声時は縮退）は Phase 0（無料ユーザーにも三体を見せる）と正面から衝突する。
Cはバックエンド変更ゼロで、既に体の数だけ粒子クラスタに分裂する `VoiceSphere` と直結できる。
**ただしCは実レイテンシを縮めない緩和策**であり、Aは将来の選択肢として残す。

| 内容 | 状態 |
|---|---|
| 逐次TTS（#4） | 解消。`lib/splitSentences.ts` で完成した文だけを切り出し、`useVoiceNarration.ts` が文ごとに読み上げへ流す。統合回答の最初の一文で喋り始める |
| 副体ラウンド中の無音（方針C） | 解消。`begin()` から `FILLER_DELAY_MS`(700ms) 後に「三人で考えています」を入れる。本文が先に始まったら出さない。単体モードでは出さない |
| バージイン（#5） | 解消。`useWakeWord` に `barge-in` モードを追加し、音声ラウンド中はウェイクワード無しで割り込める。割り込み時は読み上げと生成の両方を止める |
| エンドポインティング（#7） | 解消。`SILENCE_MS = 2500` 固定をやめ、`lib/endpointing.ts` が直前の認識文字列から 900〜3000ms を選ぶ（言い切り＝短く／接続助詞・フィラー＝長く） |
| マイクの持ち主が複数箇所に分散 | 解消。`ChatView` の `syncListening()` 1箇所で「録音中／音声ラウンド中／待機中」を決める |

**逐次TTSの注意** — `useTTS` は `speak()`（毎回 `cancel()` してから1発話）をやめ、
`enqueue()`（積むだけ）に置き換えた。`cancel()` を残したままだと、2文目が1文目を潰す。

**バージインの制約** — 割り込みを検知した時点の一言は、認識器を開き直す間に落ちる。
実際に送られるのは「割り込んだ後に話した内容」になる。自分の読み上げ音声で
自分が止まらないよう、`echoCancellation` の明示（前項）が前提になっている。

**残る穴** — 中断した応答は永続化しない（`aborted` 時は `persistMessage` を通らない）。
画面上には残るが、リロードすると消えてユーザー発言だけが「もう一度送信」の状態で残る。
会話切替による中断が切り替え先へ書き込んでしまう事故を防ぐための仕様で、
ユーザー起因の停止だけ保存するには中断理由の区別が要る。

### 2026-08-14 追加分（再検証と、公開判定の分離）

コミットは増えていないが、未達成項目を実コードで洗い直した結果、ドキュメント側の記述が
2件古くなっていたことが判明した（上の達成済み表に移動）。

| 内容 | 訂正前の記述 | 実態 |
|---|---|---|
| 思考レベルUI（棚卸し 1.6） | 「UIから到達できない」 | `SettingsDialog.vue:165-181` に5段階のUIが実装済み |
| `public/models/` の face-api（棚卸し 3.1） | 「約12MB、削除が最優先」 | 既に削除済み（`public/` に該当ファイル無し） |

**スケール上の最初の壁** — 全体枠 50回/日 ÷ 個人枠 3回/日 = **17人/日でゼロ**になる。
実際は全員が使い切らないためデイリーアクティブ30〜50人あたりが限界で、
これは Phase 4（定額課金）が想定より早く必要になることを意味する。
上限が運営の財布（$0.5/日）に由来する以上、広げる原資は課金からしか出ない。
詳細と段階別の優先順位は [public-release-readiness-20260814.md](./public-release-readiness-20260814.md) を参照。

### 2026-08-15 追加分（LLM OS 方向の確定と、公開前提の3件）

| 内容 | 状態 |
|---|---|
| **到達点を LLM OS に確定**（冒頭「到達点：LLM OS」節を新設。Phase 0〜6 はその到達順序として再定義） | 決定済み・再検討しない |
| テキスト入力（`TextComposer.vue`）／利用規約・プライバシーポリシー／退会 | 実装済み（`3dc1782` `d2be46e`）。未達成リストから達成済みへ移動 |
| `release_global_quota`（schema.sql 6章ブロックC） | **適用完了**。失敗したぶんの全体枠が返却されるようになり、キルスイッチ50回/日が名目どおり機能する |

**Layer 2 の残りについての決定** — `Capability` / `Planning` / `Execution` / `Permission` /
`Verification` を**抽象層として先に設計しない**。Phase 5 で MCP を1本ベタ書きで繋ぎ、
3本並んだ時点で共通部分を括り出す。理由は「到達点：LLM OS」節の「到達までの順序」を参照。

---

## 開発フェーズ一覧（実装順）

| Phase | 一言でいうと | 前提 | 対応する柱/根拠 | LLM OS 3層モデルでの位置 |
|---|---|---|---|---|
| **0** | 三体を既定にする | なし | 4-0（無料ユーザーが三体を一度も見られない問題） | Layer 2（Perspective を既定経路に） |
| **1** | 入口を開ける（招待制→ブロックリスト化） | Phase 0 | 4-0（Apple I脱却） | 前提整備 |
| **2** | 沈黙を消す（音声の遅延・割り込み） | なし（0・1と並行可） | 柱A（3-1） | Layer 2（Presentation＝意図表明のインターフェース） |
| **3** | 初回体験を通す（声だけで一往復） | 0・1・2 | Apple II「電源入れたら動く」 | Layer 2（同上） |
| **4** | 定額課金 | Phase 3 | 従量課金という不確実性の解消 | 資金の壁。ここを越えないと Layer 2 の残りを作る時間が買えない |
| **5** | MCP実接続 | Phase 2・4 | 柱B（3-2） | **Layer 3 の入口＝Capability 第1号** |
| **6** | マルチモーダル | Phase 5 | 柱C（3-3） | Layer 3（入出力チャネルの拡張） |

## 各フェーズの要点

**Phase 0（三体を既定に）— 完了（2026-08-09）**
`backend/routes/chat.ts` の共有キー分岐を単体(`streamBodyOAI`)から三体オーケストレーション（`orchestrateMultiBody`）に差し替え済み。プロバイダーはAnthropic単独（混成化は将来の拡張として保留）。`SHARED_DAILY_LIMIT` は 5→2（`8088f02`）→3（`98c651f`）と変遷し、**現行値は3**。

実コストを実測した結果、1ターン ≈ $0.00998（Haiku 4.5、入力5,624トークン＋出力871トークン）で、単体換算比は約3倍（見積もりの+37.5%〜2倍以下より高い）。原因は出力が上限よりずっと少なく、代わりに入力トークンが3体分そのまま3倍化する影響が相対的に大きいため。絶対額は小さい（現行の `SHARED_DAILY_LIMIT=3` で1ユーザー1日あたり最大約3セント。全体上限50回/日と合わせても約$0.5/日）ため、この実測値のまま許容と決定。

上限到達時のUXも修正済み：全画面差し替え（EmptyBrainState）を`limit_reached`では発生させず、録音を試みた時点でダイアログ（`LimitReachedDialog.vue`）で案内する方式に変更。

**Phase 1（入口を開ける）— 完了（2026-08-11）**

ホワイトリスト方式（招待した人だけ許可）からブロックリスト方式（既定で許可し、問題のあるアカウントだけ停止）へ転換。3ステップで実装した。

- **Step 1** — `checkSharedAllowance` に「行が無ければ service role で自動作成」を追加。`persistMessage` が await されない fire-and-forget のため、新規ユーザーの初回メッセージで `user_setting` 行が未作成のまま読まれる競合があったが、フロントのタイミングに依存しない形で構造的に解消
- **Step 2** — 全体日次上限（キルスイッチ）を新設。`shared_key_global_usage` テーブルと `try_reserve_global_quota` RPC。`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` の単一ステートメントで「加算」と「加算後の値の取得」を原子的に行い、`consume_shared_quota` に残る既知のTOCTOUレースを持ち込まない設計。上限は50回/日（約$0.5/日）
- **Step 3** — `can_use_shared_key` の既定を false→true に反転。`docs/schema.sql` の「6. マイグレーション」に適用SQLを記載

**適用済み** — `docs/schema.sql` 6章（ブロックA：全体上限のテーブル＋RPC／ブロックB：DEFAULT反転＋既存行バックフィル）を 2026-08-11 に Supabase へ適用。これをもって Phase 1 の完了条件（招待を受けていないアカウントがログイン後そのまま三体モードを使え、かつ運営が総額を1か所で止められる）を満たした。

**以降の運用メモ** — `can_use_shared_key = false` の意味が「まだ招待していない」から「運営が明示的に停止した」に変わっている。停止したアカウントは `[sharedKey] 停止中のアカウント（can_use_shared_key=false） user=...` としてExpressのログに出る。バックフィル用の `UPDATE`（6章ブロックB）は**二度と流さないこと**（停止したアカウントを復活させてしまう）。

**Phase 2（沈黙を消す）— 残り1件（2026-08-14 時点）**
方針は**C（球体＋相槌）で決定済み**。逐次TTS・相槌・バージイン・エンドポインティングは
2026-08-12 に実装完了（上の「追加分その2」参照）。**未了は「確認ステップの音声化」のみ**で、
これを入れれば「声だけで一往復」が閉じ、Phase 3 の前提が揃う。

**Phase 3（初回体験）**
サインイン直後を設定画面でなく「球体＋話しかけて」の一言に。`EmptyBrainState.vue` の出し分けを「まず声で試せる」前提に書き換え。

**Phase 4（定額課金）**
無料=三体固定レベル2、有料=上限引き上げ、BYOK/Ollama=無制限無料（拡張スロットとして温存）。

**前倒しの必要性（2026-08-14 追記）** — 全体枠50回/日はデイリーアクティブ30〜50人で枯れるため、
このフェーズは Phase 3 の直後（実質的には並行）に来る。無料枠を広げる原資は課金からしか出ない。
着手前に「サーバー側の入力検証」（`messages` の件数・サイズ）を必ず入れること。
有料ユーザーができた後に上限を入れると、サービス劣化として受け取られる。

**Phase 5（MCP）— LLM OS の Layer 3 に触れる最初のフェーズ**

どちらも「待ち時間を増やす」機能なのでPhase 2が前提。MCPは`ContentBlock`拡張なし、マルチモーダルは`text`/`error`/`perspective`に画像等を追加。

このフェーズの成果物は「Capability Registry」ではなく、**動く MCP 接続1本**である。

- **やること** — MCPサーバーを1本だけ選び、`backend/` にベタ書きで繋ぐ。抽象化しない
- **やらないこと** — `Capability` インターフェース、レジストリ、Planning／Permission／Verification の各層。**この時点では設計しない**
- **括り出す条件** — MCP接続が**3本**並び、3本に共通する形（呼び出し・権限確認・結果の整形）が目で見えたとき。そこで初めて共通部分を抽出し、それを `Capability Registry` と呼ぶ
- **判断基準** — 「将来こうなるはずだから」で層を足さない。2本目・3本目が実際に現れてから足す

**Phase 6（マルチモーダル）**

Layer 3 の入出力チャネル拡張。`ContentBlock` に画像等を追加する。

## 順序の根拠（要約）

Phase 0・1が先頭なのは「最も安く最も効く」（既存レバーの組み替えだけで済む）。Phase 2がPhase 3より前なのは沈黙が残ると初回体験が「壊れている」と受け取られるため。Phase 5・6が最後なのは両方とも沈黙を増やす方向の機能だから。

**LLM OS の観点を加えた根拠（2026-08-15）** — Layer 3（Capability）に手を付けるのが最後なのは、
思想上の優先度が低いからではなく、**そこが唯一「先に作ると必ず作り直しになる層」**だから。
Layer 2 の Perspective / Synthesis は既に動いており、Presentation（音声）は Phase 2・3 で閉じる。
残る Capability 以降は具体が1個も無いため、抽象から入ると実装1個分の形に固まる。
さらに現在の律速は資金（デイリーアクティブ30〜50人で全体枠が枯れる）であり、
Phase 4 を越えないと Layer 3 を作る時間そのものが確保できない。

**したがって最短路は「LLM OS を作り始める」ではなく「LLM OS を作れる体力を先に作る」。**
順序は 2 → 3 → 4 → 5（MCP 1本）→ 3本目で Registry 抽出、で固定する。
