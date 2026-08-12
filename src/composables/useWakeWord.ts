import { ref, onUnmounted } from 'vue'

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

export function useWakeWord(onWake: () => void, onBargeIn?: (transcript: string) => void) {
  const listening = ref(false)
  const supported = ref(!!(window.SpeechRecognition ?? window.webkitSpeechRecognition))
  const mode = ref<ListeningMode>('wake')

  let rec: SpeechRecognitionAPI | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  function spawn() {
    if (!listening.value) return
    const SRAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SRAPI) return

    rec = new SRAPI()
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
        // 自分の声を拾って自分で自分を止めないよう、マイク側は
        // echoCancellation を明示している（useVoiceInput）
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
      if (!listening.value) return
      // 短い間隔での連続リスタートを防ぐため 350ms 待つ
      restartTimer = setTimeout(spawn, 350)
    }

    try {
      rec.start()
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
    spawn()
  }

  function stopListening() {
    listening.value = false
    if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
    rec?.abort()
    rec = null
  }

  onUnmounted(() => stopListening())

  return { listening, supported, mode, startListening, stopListening }
}
