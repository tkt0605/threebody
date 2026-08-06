# 中嶋聡さんのMulmoシリーズとGraphAI ― まとめ

## 調査対象の3リポジトリ
- https://github.com/receptron/MulmoChat
- https://github.com/receptron/mulmoclaude
- https://github.com/receptron/mulmoterminal

## 各プロジェクトの概要

| プロジェクト | 対象領域 | 解決しようとしている課題 |
|---|---|---|
| **MulmoChat** | 一般ユーザーとのAI対話 | テキストストリームに閉じたチャットUIの限界。会話しながら画像・地図・フォーム・3Dなど視覚的コンテンツが自然に立ち上がる体験の欠如 |
| **MulmoClaude** | 個人の生活・データ | 「賢いモデル」は買えても「自分だけのAI」は買えない。SaaS型アシスタントにデータを預けることへの構造的リスク |
| **MulmoTerminal** | 開発者とAIエージェント | 複数のコーディングエージェントを並列運用する際、「どれが入力待ちか」を人間が見失う認知負荷の問題 |

## 共通する思想的骨格

1. **「LLM = 汎用OS」というメタファー**
   LLMをアプリではなく「複数の機能・プラグインを束ねる汎用コントローラー」として位置づける。
   - MulmoChat：チャットが最適なGUI（画像生成・地図・フォーム等）を呼び出す
   - MulmoClaude：チャットが会計・Wiki・スケジューラ等のプラグインを横断制御
   - MulmoTerminal：エージェント自体が並列稼働する「複数プロセス」として管理対象になる

2. **データ主権・ローカルファースト・オープンプロトコル**
   - MulmoClaude：全データを`~/mulmoclaude/`にプレーンファイルで保存し、MCP（オープン標準）で接続。ベンダーロックインを回避
   - MulmoChat：OpenAI/Anthropic/Gemini/Ollamaを抽象化、ComfyUIでローカル画像生成にも対応
   - 引用: *"something that important should not be entrusted to any single service provider"*

3. **「育てる」AI／「監督する」エージェント群**
   - MulmoClaude: *"the garden is empty; you plant seeds and tend the soil, and grow an assistant that is yours alone"*
   - MulmoTerminal：色分けステータス表示、真のPTY環境、git worktreeによる並列分離で「エージェント監督」という新しいUI役割を提示

## 総合分析：目指す未来像

**「アプリではなくエージェントを単位とするコンピューティング」への移行**を、3つの切り口から同時に土台作りしている。

1. UXの再設計（MulmoChat）― チャット＝テキストという制約を外す
2. 個人へのAI主権の返還（MulmoClaude）― 「あなたについての蓄積」を個人のローカル環境に取り戻す
3. 人間対エージェント群のインターフェース（MulmoTerminal）― 次のボトルネックは「モデルの賢さ」ではなく「複数エージェントをどう監督するか」

→ Windows 95のアーキテクトだった中嶋さんが、次世代の「LLM中核OSレイヤー」を消費者・個人データ・開発ワークフローの3方向から同時多発的に実証実験している、という構図。

## GraphAI（共通基盤）

- receptronチーム開発の**非同期データフロー実行エンジン**
- **宣言的記述**：YAML/JSONでAIワークフロー（グラフ）を記述、コード不要
- **並列実行**：依存関係のないノードは自動的に並列処理
- **モジュール性**：LLM呼び出し・ベクトル検索・HTTP等を「エージェント」として部品化
- **高度な制御フロー**：ループ・条件分岐・MapReduceに対応、RAG機能も組み込み
- LangChain等の「コードでチェーンを書く」方式と異なり、**ワークフローそのものを外部データ（グラフ）として定義**する設計
- Mulmoシリーズ全体（Mulmocast等含む）の実行エンジンであり、3プロジェクトが目指す「LLM中核OS」を実際に動かすランタイム／カーネルに相当

## 結論
MulmoChat・MulmoClaude・MulmoTerminal・GraphAIは個別プロダクトではなく、**同一の技術思想（LLM=汎用OS、データ主権、エージェント監督）に基づく一つの研究プログラム**として設計されている。
