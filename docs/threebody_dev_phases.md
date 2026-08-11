# ThreeBody 開発フェーズまとめ

作成日: 2026-08-06
前提資料: [mulmo-series-analysis-20260806.md](./mulmo-series-analysis-20260806.md) / [threebody-mulmo-alignment-20260806.md](./threebody-mulmo-alignment-20260806.md)

## 前提（両文書の関係）

- **mulmo-series-analysis** — 中嶋聡さんの3プロジェクト（MulmoChat/MulmoClaude/MulmoTerminal）の共通思想を抽出：LLM=汎用OS、データ主権、エージェント監督
- **alignment文書** — その思想とThreeBodyの現状を突き合わせ、「音声対話ファースト」を主軸に据えた上で、**音声3本柱（柱A/B/C）× 一体型移行（Apple I→II）を1本の順序に統合**したのがPhase 0〜6

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
`backend/routes/chat.ts` の共有キー分岐を単体(`streamBodyOAI`)から三体オーケストレーション（`orchestrateMultiBody`）に差し替え済み。プロバイダーはAnthropic単独（混成化は将来の拡張として保留）。`SHARED_DAILY_LIMIT` は5→2に変更済み。

実コストを実測した結果、1ターン ≈ $0.00998（Haiku 4.5、入力5,624トークン＋出力871トークン）で、単体換算比は約3倍（見積もりの+37.5%〜2倍以下より高い）。原因は出力が上限よりずっと少なく、代わりに入力トークンが3体分そのまま3倍化する影響が相対的に大きいため。絶対額は小さい（`SHARED_DAILY_LIMIT=2`で1ユーザー1日あたり最大約2セント）ため、この実測値のまま許容と決定。

上限到達時のUXも修正済み：全画面差し替え（EmptyBrainState）を`limit_reached`では発生させず、録音を試みた時点でダイアログ（`LimitReachedDialog.vue`）で案内する方式に変更。

**Phase 1（入口を開ける）— コード側完了（2026-08-11）／Supabaseへの適用待ち**

ホワイトリスト方式（招待した人だけ許可）からブロックリスト方式（既定で許可し、問題のあるアカウントだけ停止）へ転換。3ステップで実装した。

- **Step 1** — `checkSharedAllowance` に「行が無ければ service role で自動作成」を追加。`persistMessage` が await されない fire-and-forget のため、新規ユーザーの初回メッセージで `user_setting` 行が未作成のまま読まれる競合があったが、フロントのタイミングに依存しない形で構造的に解消
- **Step 2** — 全体日次上限（キルスイッチ）を新設。`shared_key_global_usage` テーブルと `try_reserve_global_quota` RPC。`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` の単一ステートメントで「加算」と「加算後の値の取得」を原子的に行い、`consume_shared_quota` に残る既知のTOCTOUレースを持ち込まない設計。上限は50回/日（約$0.5/日）
- **Step 3** — `can_use_shared_key` の既定を false→true に反転。`docs/schema.sql` の「6. マイグレーション」に適用SQLを記載

**残作業** — `docs/schema.sql` の 6-1・6-2 を Supabase SQL Editor で実行する。`ALTER ... SET DEFAULT` は既存行に効かないため、DEFAULT変更とUPDATEによるバックフィルは必ずセットかつこの順序で流す。

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
