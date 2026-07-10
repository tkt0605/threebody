---
description: 変更内容を確認し、グループごとにgit add・commitしてpushする
allowed-tools: Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git status:*), Bash(git diff:*)
argument-hint: [commit message(省略可)]
---

## 現在の状況
- git diff (staged): !`git diff --cached`
- git status: !`git status`

## 指示
上記の変更内容を確認した上で:

1. 変更され、グループ化されたファイルを`git add`する。
2. わかりやすく、シンプルなメッセージで`git commit`する(`$ARGUMENTS`が指定されていればそれを使う)
3. `git push`する

コミット前に、`.gitignore`を確認し、`.env`など機密ファイルが含まれていないかを必ず確認する。