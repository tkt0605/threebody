# .claude/commands/review.md

---
description: コードレビューを実行する。
---

以下の変更をレビューしてください:

!git diff --cached

チェック項目：
1. バグ・論理エラー
2. エラーハンドリングの漏れ
3. 命名・可読性
4. 型の安全性を考慮

各問題点を重要度（High/Medium/Low）付きで箇条書きで出力すること