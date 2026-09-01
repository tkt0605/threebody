# Issueトラッカー: GitHub

このリポジトリのIssueと仕様はGitHub Issuesで管理する。すべての操作に `gh` CLIを使う。

## 運用ルール

- **Issueを作成する**: `gh issue create --title "..." --body "..."`。複数行の本文はheredocを使う。
- **Issueを読む**: `gh issue view <number> --comments`。コメントは`jq`で絞り込み、ラベルも同時に取得する。
- **Issueを一覧する**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`。必要に応じて`--label`・`--state`で絞り込む。
- **Issueにコメントする**: `gh issue comment <number> --body "..."`
- **ラベルの付与／削除**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **クローズする**: `gh issue close <number> --comment "..."`

リポジトリは `git remote -v` から推定する。クローン内で実行すれば`gh`が自動的に判定する。

## トリアージ対象としてのプルリクエスト

**PRをリクエストとして扱う: いいえ。** _(このリポジトリが外部PRを機能リクエストとして扱う場合は`yes`にする。`/triage`がこのフラグを読む)_

`yes`に設定した場合、PRもIssueと同じラベル・状態遷移で扱う。対応する`gh pr`コマンド:

- **PRを読む**: `gh pr view <number> --comments`、差分は`gh pr diff <number>`。
- **トリアージ対象の外部PRを一覧する**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` を実行し、`authorAssociation`が`CONTRIBUTOR`・`FIRST_TIME_CONTRIBUTOR`・`NONE`のものだけを残す（`OWNER`/`MEMBER`/`COLLABORATOR`は除外）。
- **コメント／ラベル／クローズ**: `gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHubはIssueとPRで番号空間を共有しているため、`#42`のような単独表記はどちらの可能性もある。`gh pr view 42`を試し、無ければ`gh issue view 42`にフォールバックして解決する。

## スキルが「Issueトラッカーに公開する」と言ったら

GitHub Issueを作成する。

## スキルが「該当チケットを取得する」と言ったら

`gh issue view <number> --comments` を実行する。

## ウェイファインディング操作

`/wayfinder`が使用する。**マップ**は1つのIssueで、**子**Issueがチケットになる。

- **マップ**: `wayfinder:map`ラベルを付けた単一のIssue。Notes / Decisions-so-far / Fog の本文を持つ。`gh issue create --label wayfinder:map`で作成する。
- **子チケット**: マップにGitHubのsub-issueとしてリンクされたIssue（`gh api`のsub-issuesエンドポイントを使う）。sub-issuesが有効でない場合は、マップ本文のタスクリストに子を追加し、子の本文冒頭に`Part of #<map>`を書く。ラベルは`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。着手されたチケットは担当開発者にアサインされる。
- **ブロッキング**: GitHubの**ネイティブなissue依存関係**を正本（UI上でも見える表現）として使う。`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`でエッジを追加する。`<blocker-db-id>`はブロッカーの数値の**データベースID**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`で取得。`#番号`や`node_id`ではない）。GitHubは`issue_dependencies_summary.blocked_by`を報告する（未クローズのブロッカーのみを見る、生きたゲート）。依存関係機能が使えない場合は、子の本文冒頭の`Blocked by: #<n>, #<n>`行にフォールバックする。すべてのブロッカーがクローズされたときにチケットのブロックが解除される。
- **フロンティア問い合わせ**: マップの未クローズの子（`gh issue list --state open`をマップのsub-issue／タスクリストに絞って実行）を一覧し、未クローズのブロッカーがあるもの（`issue_dependencies_summary.blocked_by > 0`、または`Blocked by`行に未クローズのIssueがある）や担当者が付いているものを除外する。マップ順で最初のものが選ばれる。
- **claim（着手）**: `gh issue edit <n> --add-assignee @me`。セッションの最初の書き込み操作。
- **resolve（解決）**: `gh issue comment <n> --body "<answer>"`を実行し、次に`gh issue close <n>`。その後、マップのDecisions-so-farにコンテキストへのポインタ（gist＋リンク）を追記する。
