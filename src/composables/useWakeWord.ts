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

export function useWakeWord(onWake: () => void) {
  const listening = ref(false)
  const supported = ref(!!(window.SpeechRecognition ?? window.webkitSpeechRecognition))

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

  function startListening() {
    if (listening.value) return
    if (!(window.SpeechRecognition ?? window.webkitSpeechRecognition)) return
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

  return { listening, supported, startListening, stopListening }
}
