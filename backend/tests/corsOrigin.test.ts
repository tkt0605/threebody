import { describe, expect, it } from 'vitest'
import { requiredCorsOrigin } from '../utils/corsOrigin'

describe('requiredCorsOrigin', () => {
  it('設定されたオリジンを返す', () => {
    expect(requiredCorsOrigin('https://threebody-phi.vercel.app')).toBe(
      'https://threebody-phi.vercel.app',
    )
  })

  it('前後の空白を除去する', () => {
    expect(requiredCorsOrigin('  http://localhost:5173  ')).toBe('http://localhost:5173')
  })

  it.each([undefined, '', '   '])('未設定または空なら起動を拒否する: %j', (value) => {
    expect(() => requiredCorsOrigin(value)).toThrow(
      'VITE_ORIGIN_BASE_URL is required; refusing to start with unrestricted CORS',
    )
  })
})
