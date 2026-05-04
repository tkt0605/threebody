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
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionAPI
    webkitSpeechRecognition?: new () => SpeechRecognitionAPI
  }
}

const BAR_COUNT = 32

export function useVoiceInput(onFinish: (text: string) => void) {
  const recording  = ref(false)
  const finalText  = ref('')
  const interimText = ref('')
  const bars       = ref<number[]>(Array(BAR_COUNT).fill(0))
  const errorMsg   = ref<string | null>(null)

  let recognition: SpeechRecognitionAPI | null = null
  let audioCtx:    AudioContext       | null = null
  let analyser:    AnalyserNode       | null = null
  let stream:      MediaStream        | null = null
  let raf:         number             | null = null

  function drawBars() {
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)
    const step = Math.floor(data.length / BAR_COUNT)
    bars.value = Array.from({ length: BAR_COUNT }, (_, i) => (data[i * step] ?? 0) / 255)
    raf = requestAnimationFrame(drawBars)
  }

  async function start() {
    errorMsg.value = null

    const SRAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SRAPI) {
      errorMsg.value = 'このブラウザは音声認識に対応していません'
      return
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      errorMsg.value = 'マイクへのアクセスが拒否されました'
      return
    }

    audioCtx = new AudioContext()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 128
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    raf = requestAnimationFrame(drawBars)

    recognition = new SRAPI()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r?.isFinal) finalText.value += r[0]?.transcript ?? ''
        else interim += r?.[0]?.transcript ?? ''
      }
      interimText.value = interim
    }
    recognition.onerror = (e) => {
      if (e.error !== 'aborted') errorMsg.value = '音声認識エラーが発生しました'
    }
    recognition.onend = () => { if (recording.value) recognition?.start() }
    recognition.start()

    recording.value = true
    finalText.value = ''
    interimText.value = ''
  }

  function stop() {
    errorMsg.value = null
    recording.value = false
    recognition?.abort()
    recognition = null

    if (raf !== null) { cancelAnimationFrame(raf); raf = null }
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    audioCtx?.close()
    audioCtx = null
    analyser = null
    bars.value = Array(BAR_COUNT).fill(0)

    const text = (finalText.value + interimText.value).trim()
    finalText.value = ''
    interimText.value = ''
    if (text) onFinish(text)
  }

  onUnmounted(() => { if (recording.value) stop() })

  return { recording, finalText, interimText, bars, errorMsg, BAR_COUNT, start, stop }
}
