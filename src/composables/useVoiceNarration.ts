import { useTTS } from './useTTS'
import { takeCompleteSentences } from '../lib/splitSentences'
import type { Language } from './useSettings'

// 音声対話中の「AIが喋る側」をまとめて受け持つ。
//
// 解いている問題は2つある。
//
// 1. 応答が完成するまで一言も喋らない（外部レビュー #4）
//    → 文が1つ完成するたびに読み上げに流す。統合回答の最初の一文で喋り始める
//
// 2. 三体モードは「副体の並列応答 → 主体の統合」の2ラウンドを要するため、
//    1ラウンド目が音声では完全な無音になる（方針C：球体＋相槌で埋める）
//    → 球体の分裂アニメーションに合わせて短い相槌を入れ、待ち時間を体験に変える。
//    実時間が縮むわけではないので、これは緩和であって解決ではない

// 相槌を出すまでの待ち。すぐ本文が始まるなら相槌は邪魔なので、少しだけ待つ
export const FILLER_DELAY_MS = 700

// 「要点は声、詳細は画面」の線引きは文字数の予算ではなく中身の種類でやる。
// コード・CLIコマンドは takeCompleteSentences が文に割る前に落とすため、
// ここに残る文はもともと地の文（＝要点）だけになる。通常は上限を設けない。
// 割り込みが続いた場合だけ文数を制限する（docs/CONTENT.md ①）。

// 相槌の文言。体の数がそのまま「何人で考えているか」になる。
// lang（enqueue に渡すのと同じ BCP-47 文字列）で発話の言語も切り替える。
// 声（u.lang）だけ設定言語に合わせても、文言が日本語固定では聞き手に不自然に聞こえるため
// Language を再利用しているのは意図的。ここを 'ja' | 'en' のローカル型で
// 独立させると、useSettings.ts に3言語目が増えても本ファイルはコンパイルが通ってしまい、
// 更新漏れに気づけない。Record<Language, ...> にしておけば、Language が
// 増減した瞬間にこの2つの表がコンパイルエラーで追随を要求される
const FILLER_PEOPLE: Record<Language, { two: string; three: string }> = {
  ja: { two: '二人', three: '三人' },
  en: { two: 'two people', three: 'three people' },
}
const FILLER_TEMPLATE: Record<Language, (people: string) => string> = {
  ja: people => `${people}で考えています`,
  en: people => `${people} are thinking`,
}

export function fillerPhrase(bodyCount: number, lang = 'ja-JP'): string {
  const locale: Language = lang.startsWith('en') ? 'en' : 'ja'
  const people = FILLER_PEOPLE[locale][bodyCount >= 3 ? 'three' : 'two']
  return FILLER_TEMPLATE[locale](people)
}

export function useVoiceNarration(onIdle?: () => void) {
  const { speaking, enqueue, cancel } = useTTS(() => {
    // 読み上げるものが尽きても、まだ本文が届く途中なら「終わった」ではない
    if (ended) onIdle?.()
  })

  let active = false          // 音声で始まった対話の最中か
  let ended  = false          // 本文がすべて届いたか
  let maxSentences = Infinity
  let enqueuedSentences = 0
  let spokenUpTo = 0          // 本文のうち、どこまでを読み上げに回したか
  let fillerTimer: ReturnType<typeof setTimeout> | null = null

  function clearFiller(): void {
    if (fillerTimer !== null) { clearTimeout(fillerTimer); fillerTimer = null }
  }

  // 送信した直後に呼ぶ。ここから応答が返るまでが、いま無音になっている区間
  function begin(bodyCount: number, lang = 'ja-JP', opts?: { maxSentences?: number }): void {
    active = true
    ended = false
    maxSentences = opts?.maxSentences ?? Infinity
    enqueuedSentences = 0
    spokenUpTo = 0
    clearFiller()

    // 単体モードは1ラウンドで済み、相槌を挟むほどの間が空かない
    if (bodyCount < 2) return
    fillerTimer = setTimeout(() => {
      fillerTimer = null
      // 待っている間に本文が始まっていたら、もう相槌は要らない
      if (active && spokenUpTo === 0) enqueue(fillerPhrase(bodyCount, lang), lang)
    }, FILLER_DELAY_MS)
  }

  // ストリーミング中、その時点の本文全体を渡す。完成した文だけが読み上げに回る
  function feed(fullText: string, lang = 'ja-JP'): void {
    if (!active) return

    const pending = fullText.slice(spokenUpTo)
    const { sentences, rest } = takeCompleteSentences(pending)
    if (sentences.length === 0) return

    // 本文が始まったら相槌はもう出さない（言いかけの上に被せない）
    clearFiller()

    for (const sentence of sentences) {
      if (enqueuedSentences >= maxSentences) break
      enqueuedSentences += 1
      enqueue(sentence, lang)
    }
    // 文はtrimされるため、読み上げ済みの位置は「消費した長さ」で進める
    spokenUpTo += pending.length - rest.length
  }

  // ストリーミング完了。句点で終わらなかった最後の断片まで読み切る
  function end(fullText: string, lang = 'ja-JP'): void {
    if (!active) return
    clearFiller()
    // 最終チャンクが feed に届いていなくても、制限を超えてまとめ読みしない。
    if (maxSentences !== Infinity) feed(fullText, lang)
    ended = true

    const rest = fullText.slice(spokenUpTo)
    spokenUpTo = fullText.length
    // 空でも呼ぶ。何も鳴っていなければ useTTS 側が即座に onIdle を返す
    enqueue(enqueuedSentences < maxSentences ? rest : '', lang)

    active = false
  }

  // 停止・バージイン用。喋っているものも待機中のものも捨てる
  function stop(): void {
    clearFiller()
    active = false
    ended = false
    spokenUpTo = 0
    cancel()
  }

  return { speaking, begin, feed, end, stop }
}
