import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { extractBearerToken, resolveUserId } from '../auth'

describe('extractBearerToken', () => {
  it('Bearer トークンを取り出す', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('スキーム名の大文字小文字を区別しない', () => {
    // RFC 7235 のスキーム名は case-insensitive。クライアント実装によって表記が揺れる
    expect(extractBearerToken('bearer abc')).toBe('abc')
    expect(extractBearerToken('BEARER abc')).toBe('abc')
  })

  it('ヘッダが無い・空・別スキームなら null', () => {
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull()
    expect(extractBearerToken('abc.def.ghi')).toBeNull()
  })

  it('Bearer の後ろが空なら null', () => {
    // 空文字をトークンとして扱うと、無意味な検証リクエストをSupabaseへ投げることになる
    expect(extractBearerToken('Bearer')).toBeNull()
    expect(extractBearerToken('Bearer ')).toBeNull()
    expect(extractBearerToken('Bearer    ')).toBeNull()
  })
})

describe('resolveUserId', () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY }

  afterEach(() => {
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_KEY', saved.key]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    vi.restoreAllMocks()
  })

  it('トークンが無ければ検証せずに null を返す', async () => {
    // Supabaseへ問い合わせずに即 null。ログインしていないユーザーの
    // リクエストごとに無駄な往復を発生させない
    await expect(resolveUserId(undefined)).resolves.toBeNull()
    await expect(resolveUserId('Basic xxx')).resolves.toBeNull()
  })
})
