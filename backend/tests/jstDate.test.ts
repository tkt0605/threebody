import { describe, it, expect } from 'vitest'
import { jstDateString } from '../utils/jstDate'

// Asia/Tokyo を明示した Intl は、実装が独立していてサーバーのTZ設定にも影響されない。
// 「+9h して UTC として読む」という自前の計算を、別実装で突き合わせるための基準として使う。
// en-CA のロケールは 'YYYY-MM-DD' 形式を返す
const tokyo = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year:  'numeric',
  month: '2-digit',
  day:   '2-digit',
})

describe('jstDateString', () => {
  it('JST 0時の境界をまたぐと日付が変わる', () => {
    // UTC 14:59:59 = JST 23:59:59（まだ当日）
    expect(jstDateString(new Date('2026-08-03T14:59:59.999Z'))).toBe('2026-08-03')
    // UTC 15:00:00 = JST 翌 00:00:00（ここで切り替わる）
    expect(jstDateString(new Date('2026-08-03T15:00:00.000Z'))).toBe('2026-08-04')
  })

  it('UTCの0時では日付が変わらない', () => {
    // UTCの日付だけを見る実装（toISOString().slice(0,10)）だと、ここで誤って切り替わる。
    // JSTでは 08-03 09:00 と 08-04 08:59 で、どちらも「その日の日中」でしかない
    expect(jstDateString(new Date('2026-08-03T00:00:00.000Z'))).toBe('2026-08-03')
    expect(jstDateString(new Date('2026-08-03T23:59:59.999Z'))).toBe('2026-08-04')
  })

  it('月・年をまたぐ境界でも正しい', () => {
    // UTC 12/31 15:00 = JST 1/1 00:00
    expect(jstDateString(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01')
    expect(jstDateString(new Date('2026-12-31T14:59:59.999Z'))).toBe('2026-12-31')
    // うるう年の 2/29（2028年）
    expect(jstDateString(new Date('2028-02-28T15:00:00.000Z'))).toBe('2028-02-29')
  })

  it('サーバーのTZ設定に依存しない（Asia/Tokyo指定のIntlと一致する）', () => {
    // 境界をまたぐ48時間を1時間刻みで走査し、独立実装と全点一致することを確認する。
    // 自前の計算がTZ設定を拾っていれば、実行環境のTZ次第でここがずれる
    const start = Date.parse('2026-08-03T00:00:00.000Z')
    for (let h = 0; h < 48; h++) {
      const d = new Date(start + h * 60 * 60 * 1000)
      expect(jstDateString(d)).toBe(tokyo.format(d))
    }
  })

  it('引数を省略すると現在時刻を使い、date型に入る形式を返す', () => {
    expect(jstDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
