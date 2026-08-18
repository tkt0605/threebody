import { describe, expect, it } from 'vitest'
import { takeCompleteSentences } from '../../lib/splitSentences'

describe('takeCompleteSentences', () => {
  it('句点で区切った文だけを返し、書きかけの末尾は持ち越す', () => {
    const { sentences, rest } = takeCompleteSentences('こんにちは。今日は晴れ')
    expect(sentences).toEqual(['こんにちは。'])
    expect(rest).toBe('今日は晴れ')
  })

  it('感嘆符・疑問符・改行も文の切れ目として扱う', () => {
    const { sentences, rest } = takeCompleteSentences('やあ！元気？\n最近どう')
    expect(sentences).toEqual(['やあ！', '元気？'])
    expect(rest).toBe('最近どう')
  })

  it('区切りが来るまでは何も読み上げない（文の途中で切って喋らない）', () => {
    const { sentences, rest } = takeCompleteSentences('まだ途中の文')
    expect(sentences).toEqual([])
    expect(rest).toBe('まだ途中の文')
  })

  // ストリーミング中は ``` が片方しか届いていない時間帯がある
  it('閉じていないコードフェンス以降は読み上げに回さない', () => {
    const { sentences, rest } = takeCompleteSentences('こうします。\n```python\nprint(1)\n')
    expect(sentences).toEqual(['こうします。'])
    expect(rest).toContain('```python')
  })

  // stripMarkdown（useTTS）に任せるのでは間に合わない。\n が文の切れ目なので、
  // ここを通過した時点でコードは1行ずつの「文」になり、断片に ``` が残らず消せなくなる
  it('閉じたコードブロックは文に割る前に落とす（1行ずつ読み上げてしまうため）', () => {
    const { sentences } = takeCompleteSentences('例です。\n```js\nconst x = 1;\nconsole.log(x);\n```\n続きます。')
    expect(sentences).toEqual(['例です。', '続きます。'])
    expect(sentences.join('')).not.toContain('const x')
    expect(sentences.join('')).not.toContain('console.log')
  })

  it('コードブロックを落としても、次に読む位置（rest）はずれない', () => {
    const text = '前置き。\n```py\nprint(1)\n```\nまだ途中'
    const { rest } = takeCompleteSentences(text)
    // 未確定の末尾だけが rest に残る＝消費した長さにコードブロックが含まれる
    expect(rest).toBe('まだ途中')
  })

  // 逐次読み上げは「前回の続き」を切り出すため、消費した長さが合わないと
  // 同じ文を二度読んだり、一文まるごと飛ばしたりする
  it('sentences と rest を足すと元の文字数に戻る（空白の増減を除く）', () => {
    const text = 'ひとつめ。ふたつめ！みっつめの途中'
    const { sentences, rest } = takeCompleteSentences(text)
    const consumed = text.length - rest.length
    expect(consumed).toBe(sentences.join('').length)
  })
})
