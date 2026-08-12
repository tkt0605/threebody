import { describe, expect, it } from 'vitest'
import {
  endpointDelayMs,
  ENDPOINT_TERMINAL_MS,
  ENDPOINT_DEFAULT_MS,
  ENDPOINT_CONTINUING_MS,
  ENDPOINT_FILLER_MS,
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
