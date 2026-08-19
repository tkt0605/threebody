import { useTTS } from './useTTS'
import { takeCompleteSentences } from '../lib/splitSentences'

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

// 1回の応答で読み上げてよい上限。
//
// 目指しているのは「一切のストレスがない相棒」であって、全文を音読する装置ではない。
// 読む速度は聞く速度の2〜3倍あるので、長い回答を最後まで読み上げられている間、
// 聞き手はとっくに画面で読み終えて待たされている。カーナビが「200m先を右です」で
// 止めて地図の詳細を読み上げないのと同じ理由で、ここで切る。
//
// 100文字はおよそ1〜2文＝15秒前後。雑談（100文字未満）は今までどおり全部読まれるので、
// 短い受け答えの体験は変わらない
export const SPEECH_BUDGET_CHARS = 100

// 打ち切ったことを黙っていると「途中で壊れた」と受け取られる。
// 続きの在り処だけ伝えて、聞き手の目を画面へ送る
export const TRUNCATED_NOTICE = '続きは画面に出しました。'

// 相槌の文言。体の数がそのまま「何人で考えているか」になる
export function fillerPhrase(bodyCount: number): string {
  const people = bodyCount >= 3 ? '三人' : '二人'
  return `${people}で考えています`
}

export function useVoiceNarration(onIdle?: () => void) {
  const { speaking, enqueue, cancel } = useTTS(() => {
    // 読み上げるものが尽きても、まだ本文が届く途中なら「終わった」ではない
    if (ended) onIdle?.()
  })

  let active = false          // 音声で始まった対話の最中か
  let ended  = false          // 本文がすべて届いたか
  let spokenUpTo = 0          // 本文のうち、どこまでを読み上げに回したか
  let spokenChars = 0         // 実際に声に出した文字数（予算の消費量）
  let truncated = false       // 予算を使い切って以降を捨てたか
  let fillerTimer: ReturnType<typeof setTimeout> | null = null

  function clearFiller(): void {
    if (fillerTimer !== null) { clearTimeout(fillerTimer); fillerTimer = null }
  }

  // 送信した直後に呼ぶ。ここから応答が返るまでが、いま無音になっている区間
  function begin(bodyCount: number, lang = 'ja-JP'): void {
    active = true
    ended = false
    spokenUpTo = 0
    spokenChars = 0
    truncated = false
    clearFiller()

    // 単体モードは1ラウンドで済み、相槌を挟むほどの間が空かない
    if (bodyCount < 2) return
    fillerTimer = setTimeout(() => {
      fillerTimer = null
      // 待っている間に本文が始まっていたら、もう相槌は要らない
      if (active && spokenUpTo === 0) enqueue(fillerPhrase(bodyCount), lang)
    }, FILLER_DELAY_MS)
  }

  // ストリーミング中、その時点の本文全体を渡す。完成した文だけが読み上げに回る
  function feed(fullText: string, lang = 'ja-JP'): void {
    // 予算を使い切ったら、以降は届いても読まない（本文は画面に出続ける）
    if (!active || truncated) return

    const pending = fullText.slice(spokenUpTo)
    const { sentences, rest } = takeCompleteSentences(pending)
    if (sentences.length === 0) return

    // 本文が始まったら相槌はもう出さない（言いかけの上に被せない）
    clearFiller()

    for (const sentence of sentences) {
      if (spokenChars >= SPEECH_BUDGET_CHARS) { truncated = true; break }
      // 予算を跨いだ文も最後まで読む。文の途中で黙るのは、避けたいストレスそのもの。
      // 超過するのは長くて1文ぶんなので、上限は目安として機能すれば足りる
      enqueue(sentence, lang)
      spokenChars += sentence.length
    }
    // 文はtrimされるため、読み上げ済みの位置は「消費した長さ」で進める
    spokenUpTo += pending.length - rest.length
  }

  // ストリーミング完了。句点で終わらなかった最後の断片まで読み切る
  function end(fullText: string, lang = 'ja-JP'): void {
    if (!active) return
    clearFiller()
    ended = true

    if (truncated) {
      // 残りは読まない。黙って終わると壊れたように聞こえるので、行き先だけ伝える
      enqueue(TRUNCATED_NOTICE, lang)
    } else {
      const rest = fullText.slice(spokenUpTo)
      spokenUpTo = fullText.length
      // 空でも呼ぶ。何も鳴っていなければ useTTS 側が即座に onIdle を返す
      enqueue(rest, lang)
    }

    active = false
  }

  // 停止・バージイン用。喋っているものも待機中のものも捨てる
  function stop(): void {
    clearFiller()
    active = false
    ended = false
    spokenUpTo = 0
    spokenChars = 0
    truncated = false
    cancel()
  }

  return { speaking, begin, feed, end, stop }
}
