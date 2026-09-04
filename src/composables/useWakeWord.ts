import { ref, onUnmounted } from 'vue'
import { notifyStart, notifyEnd, waitForRelease } from '../lib/speechHandoff'
// 一時的な計測。詳しくは lib/srDebug.ts
import { attachSrDebug } from '../lib/srDebug'

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
}
interface SpeechRecognitionAPI extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror:  ((e: SpeechRecognitionErrorEvent) => void) | null
  onend:    (() => void) | null
}
declare global {
  interface Window {
    SpeechRecognition?:       new () => SpeechRecognitionAPI
    webkitSpeechRecognition?: new () => SpeechRecognitionAPI
  }
}

// ウェイクワードと許容される表記ゆれ
const WAKE_PATTERNS = ['アイリス', 'iris', 'あいりす', 'アイリ']

function matchesWakeWord(transcript: string): boolean {
  const lower = transcript.toLowerCase()
  return WAKE_PATTERNS.some(p => lower.includes(p.toLowerCase()))
}

// 聞き方は2通りある。マイクは1つしか無いので、同時に両方は回さない
//   wake      … ウェイクワードだけを待つ（待機中）
//   barge-in  … AIが喋っている最中。ウェイクワードを言わなくても、話し始めたら割り込む
export type ListeningMode = 'wake' | 'barge-in'

// バージインの発火に必要な最低文字数。1文字だと物音や「あ」で誤爆する
const BARGE_IN_MIN_CHARS = 2

// ウェイクワード待機を、何も起きないまま続ける上限。
//
// 待機中は SpeechRecognition を 350ms ごとに開き直し続け、Chrome ではその間ずっと
// 音声が Google へ送られる。タブを裏に回した場合は visibilitychange で落とせるが、
// 「タブを表にしたまま離席した」は document.hidden にならないため検知できない。
// そこで、呼ばれないまま一定時間が過ぎたら自分から降りる。
//
// 短すぎると会話の合間に切れて「呼んでも反応しない」になり、長すぎると放置対策に
// ならない。8分は「席を外した」と言い切れて、かつ考え込む間には切れない長さ
const WAKE_IDLE_MS = 8 * 60 * 1000
// const WAKE_IDLE_MS = 10 * 1000

export function useWakeWord(onWake: () => void, onBargeIn?: (transcript: string) => void) {
  const listening = ref(false)
  const supported = ref(!!(window.SpeechRecognition ?? window.webkitSpeechRecognition))
  const mode = ref<ListeningMode>('wake')

  // 呼ばれないまま待機し続けた結果、自分から降りた状態。
  // 復帰は明示的な操作（球体タップ＝録音開始）に限る。visibilitychange で自動的に
  // 戻すと、タブを行き来するだけでマイクが復活してしまう
  const idle = ref(false)

  let rec: SpeechRecognitionAPI | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function clearIdleTimer() {
    if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null }
  }

  // 録音が終わった直後にここへ戻ってくる（syncListening → barge-in / wake）。
  // 録音側の認識器はまだ手放しきっていないことがあり、待たずに開くと
  // 待機側が音を拾えないまま黙る（lib/speechHandoff.ts）。誰も掴んでいなければ即返る
  function spawn() {
    if (!listening.value) return
    if (!(window.SpeechRecognition ?? window.webkitSpeechRecognition)) return
    void waitForRelease().then(() => { if (listening.value) openRecognizer() })
  }

  function openRecognizer() {
    const SRAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SRAPI) return

    rec = new SRAPI()
    attachSrDebug(rec, 'wake')
    rec.lang = 'ja-JP'
    rec.continuous = false
    rec.interimResults = true

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i]?.[0]?.transcript ?? ''
        if (matchesWakeWord(transcript)) {
          stopListening()
          onWake()
          return
        }
        // AIが喋っている間は、ウェイクワードを言い直させない。
        // 人間の会話は割り込みで成立するので、何か話し始めた時点で黙る。
        // 自分の応答音声の回り込みは SpeechRecognition 内部の取得に任せている
        // （getUserMedia で制約を指定する経路は無くした。useVoiceInput 冒頭の注記）。
        // 最低文字数（BARGE_IN_MIN_CHARS）がその誤爆を抑える唯一の防御
        if (mode.value === 'barge-in' && transcript.trim().length >= BARGE_IN_MIN_CHARS) {
          stopListening()
          onBargeIn?.(transcript.trim())
          return
        }
      }
    }

    rec.onerror = (e) => {
      // マイク権限がない場合は検知を無効化
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        listening.value = false
        supported.value = false
      }
      // network / audio-capture など一時的なエラーは onend でリスタート
    }

    rec.onend = () => {
      // listening を見る前に手放したことを伝える。録音側はこの通知を待って
      // 認識器を開くので、ここを条件分岐の後ろに置くと待ち続けてしまう
      notifyEnd()
      if (!listening.value) return
      // 短い間隔での連続リスタートを防ぐため 350ms 待つ
      restartTimer = setTimeout(spawn, 350)
    }

    try {
      rec.start()
      notifyStart()
    } catch {
      // すでに起動中の場合は無視
    }
  }

  function startListening(nextMode: ListeningMode = 'wake') {
    // 同じ聞き方で既に回っているなら何もしない。
    // 聞き方だけが変わる場合は、走っている認識を畳んでから開き直す
    if (listening.value && mode.value === nextMode) return
    if (listening.value) stopListening()
    if (!(window.SpeechRecognition ?? window.webkitSpeechRecognition)) return

    mode.value = nextMode
    listening.value = true

    // barge-in はAIが喋っている間だけの短命なモードなので対象外。
    // 呼ばれずに時間切れになったときだけ idle を立てる
    clearIdleTimer()
    if (nextMode === 'wake') {
      idleTimer = setTimeout(() => {
        idle.value = true
        stopListening()
      }, WAKE_IDLE_MS)
    }

    spawn()
  }

  // 明示的な操作があったので待機を再開してよい、と伝える
  function resetIdle() {
    idle.value = false
  }

  function stopListening() {
    listening.value = false
    clearIdleTimer()
    if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
    rec?.abort()
    rec = null
  }

  onUnmounted(() => stopListening())

  return { listening, supported, mode, idle, startListening, stopListening, resetIdle }
}
