# .claude/commands/git_status.md

---

description: git diffとgit statusの結果を要点ごとに整理して実行。
allowed-tools: Bash(git status:*),  Bash(git diff:*)

---

## 現在の状況
- git diff (staged): !`git diff --cached`
- git status: !`git status`

## 指示
上記の結果を踏まえて、以下の要点に沿って整理してください。

1. 変更を「作成」「変更」の順にまとめる。
2. 同じフォルダに属するファイルごとにグループ化する
3. 変更が何もない場合は、「変更はなし」とだけ表示する。