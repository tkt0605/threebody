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

  it('閉じたコードブロックはそのまま通す（読み上げ時にstripMarkdownが落とす）', () => {
    const { sentences } = takeCompleteSentences('例です。\n```js\nx=1\n```\n')
    expect(sentences[0]).toBe('例です。')
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
