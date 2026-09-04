// 「話し終わったか」を、無音が続いた長さで判断するときの待ち時間。
//
// これまでは 2500ms の固定値だった。短くすると言い淀んだだけで送信され、
// 長くすると言い終わっているのに待たされる。どちらか一方に倒すしかなかったのは、
// 判断材料が「音量」しか無かったため。ここでは直前に認識できた文字列を見て、
// 「まだ続きそうか / 言い切ったか」で待ち時間を変える

// 言い切った形。ここで止まったなら、ほぼ話し終わっている
const TERMINAL = /(です|ます|ました|でした|ください|だよ|だね|かな|かも|ですか|ますか|[。．！？!?])\s*$/

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
// 認識済みテキストから、無音がこれだけ続いたら送信してよい、という長さを返す
export function endpointDelayMs(text: string): number {
  const trimmed = text.trim()

  // 一言しか取れていない状態での無音は「言いかけ」の可能性が高い。
  // ここで短く切ると、単語ひとつだけを送ってしまう
  if (trimmed.length <= 2) return ENDPOINT_FILLER_MS

  if (FILLER.test(trimmed))     return ENDPOINT_FILLER_MS
  if (CONTINUING.test(trimmed)) return ENDPOINT_CONTINUING_MS
  if (TERMINAL.test(trimmed))   return ENDPOINT_TERMINAL_MS

  return ENDPOINT_DEFAULT_MS
}
