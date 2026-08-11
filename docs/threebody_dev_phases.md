# ThreeBody 開発フェーズまとめ

作成日: 2026-08-06
前提資料: [mulmo-series-analysis-20260806.md](./mulmo-series-analysis-20260806.md) / [threebody-mulmo-alignment-20260806.md](./threebody-mulmo-alignment-20260806.md)

## 前提（両文書の関係）

- **mulmo-series-analysis** — 中嶋聡さんの3プロジェクト（MulmoChat/MulmoClaude/MulmoTerminal）の共通思想を抽出：LLM=汎用OS、データ主権、エージェント監督
- **alignment文書** — その思想とThreeBodyの現状を突き合わせ、「音声対話ファースト」を主軸に据えた上で、**音声3本柱（柱A/B/C）× 一体型移行（Apple I→II）を1本の順序に統合**したのがPhase 0〜6

---

## 達成状況（2026-08-11 / `d8a14dc` 時点）

git log と実コードで裏を取った現在地。**進捗はこの節を正本とする。**

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

### 対応不要（外部レビューの指摘が誤りだったもの）

| 指摘 | 実態 |
|---|---|
| #2 レート制限がサーバー側に無い | IP単位のrate-limit + DB/RPCによる原子的クォータが実装済み |
| #3 APIキーがlocalStorageに平文 | `keyVault.ts` でAES-GCM暗号化、鍵は非exportableでIndexedDB保持 |
| #10 三体モードがデフォルトON | キー未設定ユーザーは実質OFF（共有キー枠のみPhase 0で意図的にON） |
| #11 `NodeCanvas.vue` がポインタ必須 | 同ファイルは削除済み。**ただし同じ欠陥が `VoiceSphere.vue` に現存** → 未達成側に計上 |

### 未達成

**基盤**

- `eslint.config.js` にルールが0件／CI（`.github/workflows`）が無い（棚卸し 1.5）
- 会話履歴を毎回まるごと送信（棚卸し 1.8）
- `.env.example` が無い（棚卸し 1.4）
- `/api/chat` の BYOK 経路が無認証（棚卸し 1.10 / 外部レビュー #1）
- `stopGeneration` がUIから未配線 — 本セッションで公開したが呼び出し元が無い

**トラックA：音声（Phase 2）**

- `echoCancellation` 未指定（#6）
- 逐次TTS（#4）
- バージイン（#5）
- エンドポインティング調整（#7）

**トラックB：アクセシビリティ**

- ストリーミング出力の `aria-live`（#12）— `role="alert"` はエラー表示にのみ追加済み
- `VoiceSphere` のキーボード操作（#11）
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

**要適用** — `docs/schema.sql` 6章の**ブロックC**（`release_global_quota`）をSupabaseへ流すこと。
未適用でもチャットは動くが、失敗したぶんの全体枠が戻らず、ログに
`[sharedKey] 全体枠の解放に失敗しました` が出続ける。

---

## 開発フェーズ一覧（実装順）

| Phase | 一言でいうと | 前提 | 対応する柱/根拠 |
|---|---|---|---|
| **0** | 三体を既定にする | なし | 4-0（無料ユーザーが三体を一度も見られない問題） |
| **1** | 入口を開ける（招待制→ブロックリスト化） | Phase 0 | 4-0（Apple I脱却） |
| **2** | 沈黙を消す（音声の遅延・割り込み） | なし（0・1と並行可） | 柱A（3-1） |
| **3** | 初回体験を通す（声だけで一往復） | 0・1・2 | Apple II「電源入れたら動く」 |
| **4** | 定額課金 | Phase 3 | 従量課金という不確実性の解消 |
| **5** | MCP実接続 | Phase 2 | 柱B（3-2） |
| **6** | マルチモーダル | Phase 5 | 柱C（3-3） |

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

**Phase 2（沈黙を消す）**
逐次TTS（句点単位で`speak()`）、barge-in（再生中も低感度ASRでcancel）、確認ステップの音声化、三体モードとの緊張への方針決定（A:主体先行 / B:音声時縮退 / C:球体+相槌）を**実装前に選択**する必要あり。

**Phase 3（初回体験）**
サインイン直後を設定画面でなく「球体＋話しかけて」の一言に。`EmptyBrainState.vue` の出し分けを「まず声で試せる」前提に書き換え。

**Phase 4（定額課金）**
無料=三体固定レベル2、有料=上限引き上げ、BYOK/Ollama=無制限無料（拡張スロットとして温存）。

**Phase 5（MCP）** / **Phase 6（マルチモーダル）**
どちらも「待ち時間を増やす」機能なのでPhase 2が前提。MCPは`ContentBlock`拡張なし、マルチモーダルは`text`/`error`/`perspective`に画像等を追加。

## 順序の根拠（要約）

Phase 0・1が先頭なのは「最も安く最も効く」（既存レバーの組み替えだけで済む）。Phase 2がPhase 3より前なのは沈黙が残ると初回体験が「壊れている」と受け取られるため。Phase 5・6が最後なのは両方とも沈黙を増やす方向の機能だから。
