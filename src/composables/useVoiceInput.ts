import { ref, onUnmounted } from 'vue'
import { useSettings } from './useSettings'
import { endpointDelayMs } from '../lib/endpointing'

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

  // 認識確定後、即送信せず「この内容でいいか」を確認させる状態
  const confirming  = ref(false)
  const confirmText = ref('')

  let recognition:   SpeechRecognitionAPI | null = null
  let audioCtx:      AudioContext         | null = null
  let analyser:      AnalyserNode         | null = null
  let stream:        MediaStream          | null = null
  let raf:           number               | null = null
  let silenceTimer:  ReturnType<typeof setTimeout> | null = null
  // 発話後どれだけ静かなら自動送信するかは固定値ではなく、
  // 直前に認識できた文字列から都度決める（lib/endpointing.ts）。
  // 言い淀みで切られる／言い切っても待たされる、の両方を減らすため

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
      if (!silenceTimer) {
        // 無音に入った時点の文字列で待ち時間を決める。以降に声が出れば
        // else 側でタイマーごと捨てられ、次の無音で測り直される
        const delay = endpointDelayMs(finalText.value + interimText.value)
        silenceTimer = setTimeout(() => stop(), delay)
      }
    } else {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
    }

    raf = requestAnimationFrame(drawBars)
  }

  async function start() {
    errorMsg.value = null

    const SRAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SRAPI) {
      // 行き止まりにしないため、代わりの入口（テキスト入力欄）まで文中で示す。
      // Firefox はそもそも Web Speech API を実装していないので、ここは
      // 「一時的な失敗」ではなく「このブラウザでは今後も使えない」の意味になる
      errorMsg.value = 'このブラウザは音声入力に対応していません。下の入力欄から文字で送信できます'
      return
    }

    try {
      // audio: true（既定まかせ）だと、スピーカーから出ている自分の応答音声を
      // マイクが拾い直してしまう。ブラウザ既定でエコーキャンセルが入る環境も多いが、
      // 明示しないと保証されない。バージイン（再生中の割り込み）を入れる前提として、
      // まずここで「自分の声が返ってこない」状態を確定させる。
      // 値はすべて ideal 扱いのため、対応していない端末でも例外にはならず無視される
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // 自分の応答音声の回り込みを消す（バージインの前提）
          noiseSuppression: true,   // 定常ノイズを抑え、無音判定（SILENCE_MS）の精度を上げる
          autoGainControl:  true,   // 声の大小による認識ムラを減らす
        },
      })
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

  // 認識確定 → 即送信ではなく確認状態に入る（誤認識をそのまま送ってしまうのを防ぐ）
  function stop() {
    errorMsg.value = null
    const text = (finalText.value + interimText.value).trim()
    finalText.value = ''
    interimText.value = ''
    cleanup()
    if (text) {
      confirmText.value = text
      confirming.value = true
    }
  }

  // 確認内容でよければ送信する
  function confirmSend() {
    const text = confirmText.value
    confirming.value = false
    confirmText.value = ''
    if (text) onFinish(text)
  }

  // 確認を破棄してもう一度話し直す
  function redo() {
    confirming.value = false
    confirmText.value = ''
    start()
  }

  // 確認状態を破棄するだけ（ダイアログを閉じた場合など）
  function cancelConfirm() {
    confirming.value = false
    confirmText.value = ''
  }

  // onFinish を呼ばずに録音だけ終了する（手動送信時など）
  function cancel() {
    errorMsg.value = null
    finalText.value = ''
    interimText.value = ''
    cleanup()
  }

  onUnmounted(() => { if (recording.value) cancel() })

  return {
    recording, finalText, interimText, bars, errorMsg, BAR_COUNT,
    confirming, confirmText,
    start, stop, cancel, confirmSend, redo, cancelConfirm,
  }
}
