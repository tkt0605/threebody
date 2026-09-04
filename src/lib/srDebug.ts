// iOS 実機で SpeechRecognition のどのイベントが発火するかを、その場で目視するための計測。
//
// 目的は1つだけ。エンドポインティングの基準を「onresult が来なくなってからの経過時間」から
// 「speechend / soundend」へ移せるかを決めること。getUserMedia を外して音量が使えなくなった
// 結果、いま「まだ喋っている」を知る手段が onresult の到着しか無く、iOS が一区切りごとに
// onend → 再 start する空白がそのまま沈黙として計上されて早切れしている。
// speechend が iOS で発火するなら、それが音量の正しい代替になる。
//
// 判断がついたら、このファイルと SrDebugOverlay.vue、および呼び出し側の
// attachSrDebug / srReset をまとめて消すこと。恒久的な機能ではない。

import { ref } from 'vue'

// 有効化は URL に ?srdebug=1 を付ける。ルーターが / から /c/:id へ置換する際に
// クエリが落ちるので、読み込み時に一度だけ見て固定する
export const SR_DEBUG = new URLSearchParams(location.search).has('srdebug')

// 画面に出す行数。端末の画面を潰さない範囲で、一往復ぶんが残る長さ
const MAX_LINES = 16

// 追う対象。result は多いので別扱いにし、それ以外は素通しで記録する。
// speechstart / speechend / soundstart / soundend が本命で、
// audiostart / audioend はマイクの経路そのものが繋がったかの確認用
const TRACKED = [
  'start', 'audiostart', 'soundstart', 'speechstart',
  'speechend', 'soundend', 'audioend', 'end', 'nomatch',
] as const

export const srLog = ref<string[]>([])

let t0 = 0
let resultCount = 0

function stamp(): string {
  if (!t0) t0 = Date.now()
  return ((Date.now() - t0) / 1000).toFixed(2).padStart(5, ' ')
}

export function srMark(source: string, event: string, extra = ''): void {
  if (!SR_DEBUG) return
  srLog.value = [...srLog.value, `${stamp()} ${source} ${event}${extra && ' ' + extra}`].slice(-MAX_LINES)
}

// 録音の開始ごとに時計を戻す。前の往復の行が混ざると、どの発話の話か分からなくなる
export function srReset(): void {
  if (!SR_DEBUG) return
  t0 = Date.now()
  resultCount = 0
  srLog.value = []
}

// SpeechRecognition は EventTarget なので、既存の onXxx プロパティを一切触らずに
// addEventListener で相乗りできる。本番のハンドラと競合しない
export function attachSrDebug(rec: EventTarget, source: string): void {
  if (!SR_DEBUG) return
  for (const name of TRACKED) rec.addEventListener(name, () => srMark(source, name))
  rec.addEventListener('error', e => srMark(source, 'error', (e as { error?: string }).error ?? '?'))
  rec.addEventListener('result', () => srMark(source, 'result', `#${++resultCount}`))
}
