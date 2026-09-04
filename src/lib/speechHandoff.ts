// 音声認識サービスの受け渡し（ウェイクワード待機 → 録音）を、順番どおりに行わせる。
//
// 端末が持つ音声認識サービスは1つしかない。SpeechRecognition の stop() / abort() は
// 「解放を予約する」だけの非同期操作で、実際に手放されるのは onend が返ってからになる。
// 解放を待たずに次の認識器を start() すると、新しい方は例外も投げないまま音を1文字も
// 拾わず、そのまま沈黙してしまう（Android Chrome / iOS Safari で再現）。
//
// これが「初回だけ音声認識が動く」の正体だった。初回は
//   ① まだウェイクワード待機が始まっていない（micEverUsed が false）
//   ② マイク権限のプロンプトで数秒空く
// の2点でたまたま解放を待てていただけで、2回目以降（/c/:id）は待機が回っていて
// getUserMedia も即返るため、旧認識器が掴んだままの状態で新しい認識器を開いていた。
//
// 認識器を作る側は必ずここを通し、start() の直前に notifyStart()、onend で notifyEnd()
// を呼ぶ。次に開く側は waitForRelease() で「誰も掴んでいない」ことを確かめてから開く。

let live = 0
let waiters: Array<() => void> = []

// onend が返ってから実際にマイクが空くまでの、端末側のわずかな遅れ。
// 0 にすると解放直後の start() が再び無音を引くことがある
const SETTLE_MS = 120

// onend が来ないまま終わった認識器（タブがバックグラウンドに落ちた等）で
// 永久に待たされないための上限
const RELEASE_TIMEOUT_MS = 1500

export function notifyStart(): void {
  live++
}

export function notifyEnd(): void {
  if (live > 0) live--
  if (live > 0) return
  const pending = waiters
  waiters = []
  pending.forEach(resolve => resolve())
}

// 掴んでいる認識器が無くなるまで待つ。誰も掴んでいなければ即座に返る（初回の遅延ゼロ）
export function waitForRelease(): Promise<void> {
  if (live === 0) return Promise.resolve()

  return new Promise<void>(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      setTimeout(resolve, SETTLE_MS)
    }
    const timer = setTimeout(() => {
      // 待ち続けても来なかった。取り残されたカウントを捨てて先へ進める
      live = 0
      waiters = waiters.filter(w => w !== finish)
      finish()
    }, RELEASE_TIMEOUT_MS)
    waiters.push(finish)
  })
}

// テスト用。モジュールレベルの状態を初期化する
export function resetSpeechHandoff(): void {
  live = 0
  waiters = []
}
