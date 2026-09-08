import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// getSupabaseAdmin は結果をモジュール内にキャッシュするため、
// 環境変数を変えて試すにはモジュールごと読み直す必要がある
async function freshImport() {
  vi.resetModules()
  return import('../supabaseAdmin')
}

describe('getSupabaseAdmin', () => {
  const saved = {
    url:       process.env.VITE_SUPABASE_URL,
    key:       process.env.SUPABASE_SECRET_KEY,
    legacyKey: process.env.SUPABASE_SERVICE_KEY,
  }

  beforeEach(() => {
    process.env.VITE_SUPABASE_URL   = 'https://example.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  })

  afterEach(() => {
    for (const [name, value] of [
      ['VITE_SUPABASE_URL', saved.url],
      ['SUPABASE_SECRET_KEY', saved.key],
      ['SUPABASE_SERVICE_KEY', saved.legacyKey],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    vi.restoreAllMocks()
  })

  it('環境変数が揃っていればクライアントを返す', async () => {
    const { getSupabaseAdmin } = await freshImport()
    expect(getSupabaseAdmin()).not.toBeNull()
  })

  it('環境変数が無ければ null を返し、throw しない', async () => {
    // ここで throw するとサーバーが起動せず、共有キーと無関係な
    // 従来のBYOKユーザーまで止まる
    delete process.env.SUPABASE_SECRET_KEY
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { getSupabaseAdmin } = await freshImport()
    expect(getSupabaseAdmin()).toBeNull()
  })

  it('旧 service key の変数だけではクライアントを作らない', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    process.env.SUPABASE_SERVICE_KEY = 'legacy-service-key-for-test'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { getSupabaseAdmin } = await freshImport()
    expect(getSupabaseAdmin()).toBeNull()
  })

  it('新変数に旧 JWT 形式のキーが入っていても設定済みと扱わない', async () => {
    process.env.SUPABASE_SECRET_KEY = 'eyJlegacy'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { getSupabaseAdmin, hasSupabaseAdminConfig } = await freshImport()
    expect(hasSupabaseAdminConfig()).toBe(false)
    expect(getSupabaseAdmin()).toBeNull()
  })

  it('2回目以降は同じインスタンスを返す（毎リクエスト作り直さない）', async () => {
    const { getSupabaseAdmin } = await freshImport()
    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin())
  })

  it('null もキャッシュし、警告を繰り返さない', async () => {
    delete process.env.VITE_SUPABASE_URL
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { getSupabaseAdmin } = await freshImport()
    getSupabaseAdmin()
    getSupabaseAdmin()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
