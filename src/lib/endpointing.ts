// 「話し終わったか」を、無音が続いた長さで判断するときの待ち時間。
//
// これまでは 2500ms の固定値だった。短くすると言い淀んだだけで送信され、
// 長くすると言い終わっているのに待たされる。どちらか一方に倒すしかなかったのは、
// 判断材料が「音量」しか無かったため。ここでは直前に認識できた文字列を見て、
// 「まだ続きそうか / 言い切ったか」で待ち時間を変える

// 言い切った形。ここで止まったなら、ほぼ話し終わっている
const TERMINAL = /(です|ます|ました|でした|ください|だよ|だね|かな|かも|たい|ですか|ますか|[。．！？!?])\s*$/

// 接続助詞。「〜だけど（…）」のように、ここで止まるのは息継ぎであることが多い
const CONTINUING = /(が|けど|けれど|けれども|ので|から|ため|て|で|し|たら|なら|ながら|つつ|とか|など|、|,)\s*$/

// 言い淀み（フィラー）。考えている最中なので、いちばん長く待つ
const FILLER = /(えー|えっと|ええと|あの|あのー|そのー|うーん|んー|まあ|なんか)\s*$/

export const ENDPOINT_TERMINAL_MS   = 900   // 言い切った
export const ENDPOINT_DEFAULT_MS    = 1500  // 判断材料なし
export const ENDPOINT_CONTINUING_MS = 2400  // まだ続きそう
export const ENDPOINT_FILLER_MS     = 3000  // 考え込んでいる

// 上のENDPOINT_*はすべて「認識結果（interim/final）が更新されなくなってから」の待ち時間。
// 音量は見ない（マイクを掴むのは SpeechRecognition だけにしている。useVoiceInput 冒頭）。
// これは文字列に関係なく、結果が一度も来ない／途中で来なくなったときに強制的に切る上限。
// ENDPOINT_* の最大値より長くしておくこと（短いと言い淀みの待ちを先に切ってしまう）
export const STALL_TIMEOUT_MS = 5000

// 上のENDPOINT_*は「人がどう言い終えたか」しか見ていない。認識器が結果をどれくらいの
// 間隔で返すかは勘定に入っておらず、そこが端末で桁違いに違う（実機計測、2026-09-04）：
//   PC Chrome  … 12秒間に36件。平均 0.26 秒間隔で、発話中に空白ができない
//   iOS Chrome … 1.4 秒に9件出したあと止まる。喋っている最中に 1.38〜1.50 秒空く
// ENDPOINT_DEFAULT_MS の 1500ms は iOS の空白と同じ幅なので、息継ぎでもない場所で
// 切れる。UA で分岐すると将来の端末に追従できないので、実測値で下限を決める。
const GAP_MARGIN = 1.8

// 下限の上限。endpoint は STALL_TIMEOUT_MS より必ず手前で発火させる必要がある
// （追い越すと「結果が来ない」の保険が先に走り、送信ではなく破棄になる）
export const ENDPOINT_FLOOR_MAX_MS = 3500

// この端末が結果と結果の間に空けた、これまでの最大幅。
// ページを開いている間ずっと持ち越す。1往復では標本が10件程度しか取れないので、
// 録音ごとに捨てると学習が進まない
let observedMaxGapMs = 0

// 結果が届いたときの、直前の結果からの間隔を記録する。上限が伸びたら true。
//
// 記録できるのは「空白のあとに結果が実際に届いた」ケースだけで、切ってしまった空白は
// 標本にならない。そのため下限は現在のしきい値を超える幅までしか一度には伸びず、
// 往復を重ねて段階的に収束する（iOS は 1.38 秒を拾って 2.4 秒台まで上がり、
// 次の往復で 1.50 秒の空白を切らずに済むようになる）
export function noteResultGap(gapMs: number): boolean {
  if (!(gapMs > observedMaxGapMs)) return false
  observedMaxGapMs = gapMs
  return true
}

export function observedGapMs(): number {
  return observedMaxGapMs
}

// テスト用。モジュールレベルの状態を初期化する
export function resetObservedGap(): void {
  observedMaxGapMs = 0
}

// 実測した空白から決まる、待ち時間の下限
export function endpointFloorMs(maxGapMs: number): number {
  return Math.min(maxGapMs * GAP_MARGIN, ENDPOINT_FLOOR_MAX_MS)
}

// 認識済みテキストから、無音がこれだけ続いたら送信してよい、という長さを返す。
// maxGapMs には observedGapMs() を渡す。0 なら従来どおり文字列だけで決まる
export function endpointDelayMs(text: string, maxGapMs = 0): number {
  const trimmed = text.trim()
  const floor = endpointFloorMs(maxGapMs)

  // 一言しか取れていない状態での無音は「言いかけ」の可能性が高い。
  // ここで短く切ると、単語ひとつだけを送ってしまう
  if (trimmed.length <= 2) return Math.max(ENDPOINT_FILLER_MS, floor)

  if (FILLER.test(trimmed))     return Math.max(ENDPOINT_FILLER_MS, floor)
  if (CONTINUING.test(trimmed)) return Math.max(ENDPOINT_CONTINUING_MS, floor)
  if (TERMINAL.test(trimmed))   return Math.max(ENDPOINT_TERMINAL_MS, floor)

  return Math.max(ENDPOINT_DEFAULT_MS, floor)
}
