import { ref, onUnmounted } from 'vue'
import { useSettings } from './useSettings'

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

const LANG_LOCALE: Record<string, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
  fr: 'fr-FR',
  es: 'es-ES',
  de: 'de-DE',
}

const BAR_COUNT = 32

export function useVoiceInput(onFinish: (text: string) => void) {
  const { settings } = useSettings()
  const recording  = ref(false)
  const finalText  = ref('')
  const interimText = ref('')
  const bars       = ref<number[]>(Array(BAR_COUNT).fill(0))
  const errorMsg   = ref<string | null>(null)

  let recognition:   SpeechRecognitionAPI | null = null
  let audioCtx:      AudioContext         | null = null
  let analyser:      AnalyserNode         | null = null
  let stream:        MediaStream          | null = null
  let raf:           number               | null = null
  let silenceTimer:  ReturnType<typeof setTimeout> | null = null
  const SILENCE_MS = 2500  // 発話後この時間静かなら自動送信

  function drawBars() {
    if (!analyser || !audioCtx) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)

    // 声域 80Hz〜4000Hz の範囲だけを32バーにマッピング
    const nyquist = audioCtx.sampleRate / 2
    const minBin = Math.floor(80 / nyquist * analyser.frequencyBinCount)
    const maxBin = Math.ceil(4000 / nyquist * analyser.frequencyBinCount)
    const range = maxBin - minBin

    bars.value = Array.from({ length: BAR_COUNT }, (_, i) => {
      const lo = minBin + Math.floor(i * range / BAR_COUNT)
      const hi = minBin + Math.floor((i + 1) * range / BAR_COUNT)
      const count = Math.max(hi - lo, 1)
      let sum = 0
      for (let j = lo; j < hi; j++) sum += data[j] ?? 0
      // 知覚的なカーブ（小さな音量でも視覚的に反応させる）
      return Math.pow(sum / count / 255, 0.65)
    })

    // 発話が始まった後、沈黙が続いたら自動送信
    const hasText = !!(finalText.value || interimText.value)
    const avgVol  = bars.value.reduce((a, b) => a + b, 0) / BAR_COUNT
    const silent  = avgVol < 0.06

    if (hasText && silent) {
      if (!silenceTimer) silenceTimer = setTimeout(() => stop(), SILENCE_MS)
    } else {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
    }

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
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.8
    analyser.minDecibels = -85
    analyser.maxDecibels = -10
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    raf = requestAnimationFrame(drawBars)

    recognition = new SRAPI()
    recognition.lang = LANG_LOCALE[settings.language] ?? 'ja-JP'
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

  function cleanup() {
    recording.value = false
    recognition?.abort()
    recognition = null
    if (silenceTimer !== null) { clearTimeout(silenceTimer); silenceTimer = null }
    if (raf !== null) { cancelAnimationFrame(raf); raf = null }
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    audioCtx?.close()
    audioCtx = null
    analyser = null
    bars.value = Array(BAR_COUNT).fill(0)
  }

  function stop() {
    errorMsg.value = null
    const text = (finalText.value + interimText.value).trim()
    finalText.value = ''
    interimText.value = ''
    cleanup()
    if (text) onFinish(text)
  }

  // onFinish を呼ばずに録音だけ終了する（手動送信時など）
  function cancel() {
    errorMsg.value = null
    finalText.value = ''
    interimText.value = ''
    cleanup()
  }

  onUnmounted(() => { if (recording.value) cancel() })

  return { recording, finalText, interimText, bars, errorMsg, BAR_COUNT, start, stop, cancel }
}
