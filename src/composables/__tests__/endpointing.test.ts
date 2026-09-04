import { beforeEach, describe, expect, it } from 'vitest'
import {
  endpointDelayMs,
  endpointFloorMs,
  noteResultGap,
  observedGapMs,
  resetObservedGap,
  ENDPOINT_TERMINAL_MS,
  ENDPOINT_DEFAULT_MS,
  ENDPOINT_CONTINUING_MS,
  ENDPOINT_FILLER_MS,
  ENDPOINT_FLOOR_MAX_MS,
  STALL_TIMEOUT_MS,
} from '../../lib/endpointing'

describe('endpointDelayMs', () => {
  it('言い切っていればすぐ送る', () => {
    expect(endpointDelayMs('明日の天気を教えてください')).toBe(ENDPOINT_TERMINAL_MS)
    expect(endpointDelayMs('これはどういう意味ですか')).toBe(ENDPOINT_TERMINAL_MS)
    expect(endpointDelayMs('わかりました。')).toBe(ENDPOINT_TERMINAL_MS)
  })

  it('接続助詞で止まっているうちは続きを待つ', () => {
    expect(endpointDelayMs('この前の件なんだけど')).toBe(ENDPOINT_CONTINUING_MS)
    expect(endpointDelayMs('時間がないので')).toBe(ENDPOINT_CONTINUING_MS)
  })

  it('言い淀んでいるときは最も長く待つ', () => {
    expect(endpointDelayMs('その資料の、えっと')).toBe(ENDPOINT_FILLER_MS)
    expect(endpointDelayMs('なんて言うか うーん')).toBe(ENDPOINT_FILLER_MS)
  })

  // 一言だけ取れた状態の無音は、言い終わりではなく言いかけであることが多い
  it('二文字以下は言いかけとみなして長く待つ', () => {
    expect(endpointDelayMs('あ')).toBe(ENDPOINT_FILLER_MS)
    expect(endpointDelayMs('明日')).toBe(ENDPOINT_FILLER_MS)
  })

  it('判断材料が無ければ既定値', () => {
    expect(endpointDelayMs('東京の人口')).toBe(ENDPOINT_DEFAULT_MS)
  })

  // 2500ms固定だった頃と比べ、言い切りは短く・言い淀みは長くなっている必要がある
  it('言い切りは言い淀みより必ず短い', () => {
    expect(ENDPOINT_TERMINAL_MS).toBeLessThan(ENDPOINT_CONTINUING_MS)
    expect(ENDPOINT_CONTINUING_MS).toBeLessThan(ENDPOINT_FILLER_MS)
  })
})

// 認識器が結果を返す間隔は端末差が大きい。PC Chrome は 0.26 秒間隔で途切れないが、
// iOS Chrome は発話中に 1.38〜1.50 秒空ける（実機計測、2026-09-04）。
// その空白を「言い終わった」と読むと、喋っている途中で送信されてしまう
describe('結果の到着間隔による下限', () => {
  beforeEach(() => resetObservedGap())

  it('PC Chrome の間隔では従来の待ち時間が変わらない', () => {
    noteResultGap(260)
    expect(endpointDelayMs('東京の人口', observedGapMs())).toBe(ENDPOINT_DEFAULT_MS)
    expect(endpointDelayMs('わかりました。', observedGapMs())).toBe(ENDPOINT_TERMINAL_MS)
  })

  it('iOS Chrome の間隔では既定値より長く待つ', () => {
    noteResultGap(1380)
    expect(endpointDelayMs('東京の人口', observedGapMs())).toBeGreaterThan(ENDPOINT_DEFAULT_MS)
    // 次の往復で 1.50 秒の空白に出くわしても切らずに済む幅になっている
    expect(endpointDelayMs('東京の人口', observedGapMs())).toBeGreaterThan(1500)
  })

  it('観測した最大幅だけを持ち越す', () => {
    expect(noteResultGap(1380)).toBe(true)
    expect(noteResultGap(300)).toBe(false)
    expect(observedGapMs()).toBe(1380)
  })

  // 下限が STALL_TIMEOUT_MS に追いつくと、送信ではなく破棄が先に走ってしまう
  it('下限は STALL_TIMEOUT_MS を追い越さない', () => {
    noteResultGap(60_000)
    expect(endpointFloorMs(observedGapMs())).toBe(ENDPOINT_FLOOR_MAX_MS)
    expect(endpointDelayMs('東京の人口', observedGapMs())).toBeLessThan(STALL_TIMEOUT_MS)
    expect(endpointDelayMs('その資料の、えっと', observedGapMs())).toBeLessThan(STALL_TIMEOUT_MS)
  })

  it('未計測なら文字列だけで決まる', () => {
    expect(endpointDelayMs('東京の人口', observedGapMs())).toBe(ENDPOINT_DEFAULT_MS)
  })
})
