import { ref, nextTick, onUnmounted } from 'vue'
import { useSettings, type Language } from './useSettings'
import { endpointDelayMs, STALL_TIMEOUT_MS } from '../lib/endpointing'
import { notifyStart, notifyEnd, waitForRelease } from '../lib/speechHandoff'

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

// 対応言語は ja / en の2つ。ChatView の ttsLang（読み上げ）が元からこの2つしか
// 持っておらず、他言語は認識だけ通って読み上げが英語になるという壊れ方をしていた
const LANG_LOCALE: Record<Language, string> = {
  ja: 'ja-JP',
  en: 'en-US',
}

const BAR_COUNT = 32

// バーの平均音量が「人が話している」と言える大きさ。沈黙判定（0.06）より上に取る
const SPEECH_VOL = 0.12

// 声は聞こえているのに認識結果が1文字も返ってこない状態が続いたら、
// 認識器が音を受け取れていないと見なして開き直すまでの時間。
// 端末側のイベント（audiostart）は実装差が大きいので、Web Audio 側の
// 解析結果と認識結果のズレという、ブラウザに依存しない材料で判断する
const DEAF_TIMEOUT_MS = 2200

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
  let restartTimer:  ReturnType<typeof setTimeout> | null = null
  let lastResultAt = 0
  // 認識器が本当に音を受け取れているかの判定材料（drawBars で使う）
  let gotAnyResult = false
  let speechSince  = 0
  let reopened     = false
  // 発話後どれだけ静かなら自動送信するかは固定値ではなく、
  // 直前に認識できた文字列から都度決める（lib/endpointing.ts）。
  // 言い淀みで切られる／言い切っても待たされる、の両方を減らすため

  function drawBars() {
    if (!analyser || !audioCtx) return

    // 生活音などで音量が閾値を割らず、下の沈黙判定が一生発火しないケースの保険。
    // 音量とは無関係に「新しい認識結果が来ているか」だけを見る
    if (Date.now() - lastResultAt >= STALL_TIMEOUT_MS) {
      // 一度も認識できないまま時間切れになったなら、それは「話さなかった」ではなく
      // 認識器が音を受け取れていない。黙って畳むと、画面には「聴いてます」が5秒出て
      // 何事も無かったように消えるだけで、失敗したことすら分からない
      // !gotAnyResultにすることで、逆数をとっている。今回は、行66からtrue
      const deaf = !gotAnyResult
      stop()
      if (deaf) errorMsg.value = '音声を認識できませんでした。もう一度お試しください（下の入力欄から文字でも送れます）'
      return
    }

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

    // 声は届いているのに認識結果が返ってこないなら、認識器が音を受け取れていない。
    // 例外も onerror も出ないまま黙る失敗の仕方をするので、こちらから開き直す。
    // 開き直しは1回だけ。効かなければ下の STALL_TIMEOUT_MS で畳む
    if (!gotAnyResult && !reopened) {
      // 声が途切れても測り直さない。文中の息継ぎで毎回リセットされると、
      // 2.2秒ぶん途切れずに喋り続けたときしか検知できなくなる
      if (!speechSince && avgVol >= SPEECH_VOL) speechSince = Date.now()
      if (speechSince && Date.now() - speechSince >= DEAF_TIMEOUT_MS) {
        reopened = true
        reopenRecognition()
      }
    }

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

  // 認識器を1つ作って回し始める。開き直し（reopenRecognition）からも呼ぶので、
  // start() 本体から切り出してある
  function spawnRecognition() {
    const SRAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SRAPI) return

    recognition = new SRAPI()
    recognition.lang = LANG_LOCALE[settings.language] ?? 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (e) => {
      lastResultAt = Date.now()
      gotAnyResult = true
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
    // continuous でも端末側の都合で勝手に閉じる（Android は一発話ごとに閉じることがある）。
    // 録音中はそのつど開き直すが、閉じた直後の start() は例外になることがあるので
    // 例外は握って次のフレームへ回す。ここを素通しにすると recording だけ true のまま
    // 認識器が居ない状態になり、無音のまま STALL_TIMEOUT_MS で畳まれる
    recognition.onend = () => {
      notifyEnd()
      if (!recording.value) return
      tryStart(recognition)
    }

    tryStart(recognition)
  }

  function tryStart(rec: SpeechRecognitionAPI | null) {
    if (!rec || !recording.value) return
    try {
      rec.start()
      notifyStart()
    } catch {
      // まだ閉じきっていない。少し置いて、そのとき現役の認識器で開き直す
      if (restartTimer !== null) clearTimeout(restartTimer)
      restartTimer = setTimeout(() => {
        restartTimer = null
        if (recording.value && recognition === rec) tryStart(rec)
      }, 250)
    }
  }

  // 音は届いているのに認識結果が返らないときの立て直し。
  // 認識器だけを作り直す（マイクのストリームと解析器はそのまま使う）
  function reopenRecognition() {
    const dead = recognition
    recognition = null
    if (dead) {
      dead.onend = () => notifyEnd()
      dead.onresult = null
      dead.onerror = null
      dead.abort()
    }
    lastResultAt = Date.now()
    speechSince = 0
    void waitForRelease().then(() => {
      if (recording.value && !recognition) spawnRecognition()
    })
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

    gotAnyResult = false
    speechSince  = 0
    reopened     = false

    // ここで先に recording を立てる。ChatView の syncListening() はこの変更を
    // watch で受けて、ウェイクワード待機中の認識器を止める
    recording.value = true

    // 止めるだけでは足りない。abort() は解放を予約するだけで、実際にマイクが空くのは
    // 認識器の onend が返ってから。そこを待たずに次を開くと、新しい認識器は例外も
    // エラーイベントも出さないまま一切音を拾わない（lib/speechHandoff.ts）。
    //   nextTick        … syncListening が走って、ウェイクワード側に abort が届く
    //   waitForRelease  … その abort が本当に効いて手放されるまで待つ
    // 誰も掴んでいなければ waitForRelease は即座に返るので、初回は待たされない
    await nextTick()
    await waitForRelease()
    // 待っている間にキャンセルされた（cancel / 別経路での stop）
    if (!recording.value) return

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
      recording.value = false
      errorMsg.value = 'マイクへのアクセスが拒否されました'
      return
    }

    audioCtx = new AudioContext()
    // モバイルの AudioContext は、ユーザー操作のタスクの中で作らないと suspended で
    // 生まれる。上の await を挟んだ時点でここは操作のタスクから外れているため、
    // 明示的に起こさないと解析結果が全バー 0 になり、沈黙判定が即座に成立して
    // 言い切る前に送信されてしまう（ウェイクワード経由はそもそも操作が無い）
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume() } catch { /* 起こせなくても STALL 側の保険で畳める */ }
      // resume を待つ間に降ろされたら、掴んだものを返して何も始めない
      if (!recording.value) { cleanup(); return }
    }
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.8
    analyser.minDecibels = -85
    analyser.maxDecibels = -10
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    lastResultAt = Date.now()
    raf = requestAnimationFrame(drawBars)

    finalText.value = ''
    interimText.value = ''
    spawnRecognition()
  }

  function cleanup() {
    recording.value = false
    recognition?.abort()
    recognition = null
    if (silenceTimer !== null) { clearTimeout(silenceTimer); silenceTimer = null }
    if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
    if (raf !== null) { cancelAnimationFrame(raf); raf = null }
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    audioCtx?.close()
    audioCtx = null
    analyser = null
    bars.value = Array(BAR_COUNT).fill(0)
  }

  // 認識確定 → そのまま送信する。
  //
  // 以前はここで確認状態（『◯◯でいいですか？』）に入っていたが、抜けるのに画面の
  // タップが必要で、声だけで一往復が閉じなかった。送信は取り消せる操作なので、
  // 「可逆なら推測して実行し、不可逆なら訊く」の原則に従って確認を外している。
  // 誤認識したときは、アイリスが答え始めたところへ割り込んで（バージイン）言い直す。
  // 人間同士の会話と同じく、送信そのものは取り消さない
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

  return {
    recording, finalText, interimText, bars, errorMsg, BAR_COUNT,
    start, stop, cancel,
  }
}
