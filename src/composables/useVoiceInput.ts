import { ref, nextTick, onUnmounted } from 'vue'
import { useSettings, type Language } from './useSettings'
import { endpointDelayMs, STALL_TIMEOUT_MS } from '../lib/endpointing'
import { notifyStart, notifyEnd, waitForRelease } from '../lib/speechHandoff'
// 一時的な計測。エンドポインティングの基準を speechend へ移せるかを実機で見るためだけのもの
import { attachSrDebug, srReset } from '../lib/srDebug'

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

// 録音中にマイクを掴むのは SpeechRecognition だけにする。
//
// 以前は音量バーの描画と無音判定のために getUserMedia → AudioContext → AnalyserNode を
// 併走させていたが、iOS（Safari も Chrome も中身は WebKit）では2系統の音声取得を同時に
// 持つと認識側が例外も onerror も出さずに沈黙した。PC では再現せず、ウェイクワード待機
// （SpeechRecognition 単独）は iOS でも動いていたので、原因は「2系統同時」そのもの。
// 認識器を作り直しても analyser 側がマイクを握ったままなので直らなかった。
//
// そのため音量は測らない。バーは「認識結果が届いたか」で動かす演出で、無音判定は
// 「認識結果が更新されなくなってからの経過時間」だけで行う（音量を見ない）。
//
// 結果が届いた瞬間のバーの高さ。実マイク時代の発話中の平均（0.2〜0.4）に合わせる
const LEVEL_ON_RESULT = 0.35
// 1フレームごとの減衰。結果が途切れると 0.3 秒ほどで静まる
const LEVEL_DECAY = 0.9
// 何も届いていない間の「聴いている」ゆらぎ
const LEVEL_BREATH_BASE = 0.04
const LEVEL_BREATH_AMP  = 0.03

export function useVoiceInput(onFinish: (text: string) => void) {
  const { settings } = useSettings()
  const recording  = ref(false)
  const finalText  = ref('')
  const interimText = ref('')
  const bars       = ref<number[]>(Array(BAR_COUNT).fill(0))
  const errorMsg   = ref<string | null>(null)

  let recognition:   SpeechRecognitionAPI | null = null
  let raf:           number               | null = null
  let restartTimer:  ReturnType<typeof setTimeout> | null = null
  let lastResultAt = 0
  let gotAnyResult = false
  let level = 0
  // 発話後どれだけ静かなら自動送信するかは固定値ではなく、
  // 直前に認識できた文字列から都度決める（lib/endpointing.ts）。
  // 言い淀みで切られる／言い切っても待たされる、の両方を減らすため

  function tick() {
    if (!recording.value) return
    const now = Date.now()
    const sinceResult = now - lastResultAt

    // 認識結果が一定時間まったく来なければ畳む。
    // 一度も認識できないまま時間切れになったなら、それは「話さなかった」ではなく
    // 認識器が音を受け取れていない。黙って畳むと、画面には「聴いてます」が5秒出て
    // 何事も無かったように消えるだけで、失敗したことすら分からない
    if (sinceResult >= STALL_TIMEOUT_MS) {
      const deaf = !gotAnyResult
      stop()
      if (deaf) errorMsg.value = '音声を認識できませんでした。もう一度お試しください（下の入力欄から文字でも送れます）'
      return
    }

    // 発話が始まった後、認識結果の更新が止まったら自動送信。
    // 待つ長さは止まった時点の文字列で決まる。結果が止まっている間は文字列も
    // 変わらないので、毎フレーム評価しても同じ値になる
    const text = finalText.value + interimText.value
    if (text && sinceResult >= endpointDelayMs(text)) {
      stop()
      return
    }

    level *= LEVEL_DECAY
    const breath = LEVEL_BREATH_BASE + LEVEL_BREATH_AMP * Math.sin(now / 400)
    bars.value = Array(BAR_COUNT).fill(Math.max(level, breath))

    raf = requestAnimationFrame(tick)
  }

  function spawnRecognition() {
    const SRAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SRAPI) return

    recognition = new SRAPI()
    attachSrDebug(recognition, 'rec ')
    recognition.lang = LANG_LOCALE[settings.language] ?? 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (e) => {
      lastResultAt = Date.now()
      gotAnyResult = true
      level = LEVEL_ON_RESULT
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r?.isFinal) finalText.value += r[0]?.transcript ?? ''
        else interim += r?.[0]?.transcript ?? ''
      }
      interimText.value = interim
    }
    recognition.onerror = (e) => {
      if (e.error === 'aborted') return
      // マイク権限は getUserMedia を経由しなくなったので、拒否はここでしか分からない
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        cancel()
        errorMsg.value = 'マイクへのアクセスが拒否されました'
        return
      }
      errorMsg.value = '音声認識エラーが発生しました'
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
    level = 0
    srReset()

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

    lastResultAt = Date.now()
    finalText.value = ''
    interimText.value = ''
    spawnRecognition()
    raf = requestAnimationFrame(tick)
  }

  function cleanup() {
    recording.value = false
    recognition?.abort()
    recognition = null
    if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
    if (raf !== null) { cancelAnimationFrame(raf); raf = null }
    level = 0
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
