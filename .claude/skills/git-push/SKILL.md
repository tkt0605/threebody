---
name: git-push
description: 変更内容を確認し、グループごとにgit add・commitしてpushする
commands:
  - git check-ignore -v
  - git add
  - git commit
  - git push
  - git status
  - git diff
allowed-tools:
  - bash(git check-ignore -v:*)
  - bash(git add:*)
  - bash(git commit:*)
  - bash(git push:*)
  - bash(git status:*)
  - bash(git diff:*)
---

## 現在の状況
- git diff (staged): !`git diff --cached`
- git status: !`git status`

## 指示
上記の変更内容を確認した上で、ユーザーに対して以下のルールを厳格に守って変更点を提示してください。

1. **変更タイプのファイルをステージする**: 変更され、グループ化されたファイルを`git add`する。
2. **コミットメッセージを入力する**: `git commit -m`でわかりやすく、シンプルなメッセージを入力する。もしユーザーが引数としてコミットメッセージを指定していれば、それを使用する。
3. **変更をリモートに反映する**: `git push`で変更をリモートリポジトリに反映する。

コミット前に、`.gitignore`を確認し、`.env`など機密ファイルが含まれていないかを必ず確認する。