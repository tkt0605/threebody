import { describe, expect, it } from 'vitest'
import { stripMarkdown } from '../../lib/stripMarkdown'

describe('stripMarkdown', () => {
  it('コードブロックを丸ごと落とす', () => {
    expect(stripMarkdown('実行前に確認。\n```bash\npython server.py\n```\n以上。'))
      .toBe('実行前に確認。\n\n以上。')
  })

  it('インラインコードはバッククォートだけ外し、中身は読み上げる', () => {
    expect(stripMarkdown('`ws`ライブラリでサーバーを立てる')).toBe('wsライブラリでサーバーを立てる')
    expect(stripMarkdown('`escapeHtml`はXSS対策')).toBe('escapeHtmlはXSS対策')
  })

  it('括弧の中身は全角・半角どちらも読み上げない', () => {
    expect(stripMarkdown('この方法（推奨）を使う')).toBe('この方法を使う')
    expect(stripMarkdown('this method (recommended) works')).toBe('this method works')
  })

  it('画像・リンクはラベルだけ残す', () => {
    expect(stripMarkdown('![説明](img.png)')).toBe('説明')
    expect(stripMarkdown('[ここ](https://example.com)を見て')).toBe('ここを見て')
  })

  it('見出し・強調・箇条書き記号を落として本文だけ残す', () => {
    expect(stripMarkdown('## 見出し\n**太字**の答え')).toBe('見出し\n太字の答え')
    expect(stripMarkdown('- 項目1\n- 項目2')).toBe('項目1\n項目2')
  })
})
