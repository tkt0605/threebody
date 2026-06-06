# .claude/commands/ship.md

---
description: テスト -> init -> commit -> PRまで一気にやる
---

!git diff --staged

上記の変更に対して：
1. `npm run typecheck`　でエラーがないかを確認
2. `npm run lint`　を実行
3. Conventional Commits形式でコミットメッセージを作成してコミット
4. PRを作成してdraftで開く