// ストリーミング中の本文から「読み上げてよい部分」だけを切り出す。
//
// 逐次TTSの肝は、まだ書き終わっていない文を喋らないこと。
// 途中まで届いた文をそのまま読むと、文の途中でぶつ切りになったり、
// 直後に届いた続きを二重に読むことになる

// 文の終わりとみなす文字。日本語の句点と、英文・記号の終端をひととおり
const SENTENCE_END = /[。．！？!?\n]/

export interface SentenceCut {
  // 読み上げてよい完成した文（区切り文字を含む）
  sentences: string[]
  // まだ完成していない末尾。次の呼び出しで続きと連結される
  rest: string
}

// 閉じていないコードフェンス以降を切り落とす。
// ストリーミング中は ``` が片方しか届いていない時間帯があり、
// そのまま読み上げると「バッククォート バッククォート バッククォート パイソン」に化ける
function dropUnclosedCodeFence(text: string): { body: string; dropped: string } {
  const fences = text.match(/```/g)?.length ?? 0
  if (fences % 2 === 0) return { body: text, dropped: '' }

  const lastFence = text.lastIndexOf('```')
  return { body: text.slice(0, lastFence), dropped: text.slice(lastFence) }
}

// text のうち、文として完成している部分と、まだ途中の部分に分ける
export function takeCompleteSentences(text: string): SentenceCut {
  const { body, dropped } = dropUnclosedCodeFence(text)

  const sentences: string[] = []
  let buffer = ''

  for (const char of body) {
    buffer += char
    if (SENTENCE_END.test(char)) {
      if (buffer.trim()) sentences.push(buffer.trim())
      buffer = ''
    }
  }

  return { sentences, rest: buffer + dropped }
}
