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

// 閉じ終わったコードフェンスを丸ごと落とす。
//
// stripMarkdown（useTTS）も同じ正規表現を持っているが、あちらでは間に合わない。
// SENTENCE_END が \n を含むため、ここを通過した時点でコードは1行ずつ「完成した文」に
// 割られ、`app = Flask(__name__)` のような断片には ``` が残らないので消せなくなる。
// 落とすなら文に割る前でなければならない。
//
// 落とした跡に改行を残すのは、コードの前後の文が地続きに繋がって
// 1つの文として読まれるのを防ぐため
function dropClosedCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '\n')
}

// text のうち、文として完成している部分と、まだ途中の部分に分ける
export function takeCompleteSentences(text: string): SentenceCut {
  const { body, dropped } = dropUnclosedCodeFence(text)
  // rest は「まだ確定していない末尾」だけを表せばよく、呼び出し側（useVoiceNarration.feed）は
  // 消費した長さを pending.length - rest.length で数える。body から中身を削っても
  // 末尾の断片は変わらないため、読み上げ位置の計算はずれない
  const readable = dropClosedCodeFences(body)

  const sentences: string[] = []
  let buffer = ''

  for (const char of readable) {
    buffer += char
    if (SENTENCE_END.test(char)) {
      if (buffer.trim()) sentences.push(buffer.trim())
      buffer = ''
    }
  }

  return { sentences, rest: buffer + dropped }
}
