import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// getSupabaseAdmin は結果をモジュール内にキャッシュするため、
// 環境変数を変えて試すにはモジュールごと読み直す必要がある
async function freshImport() {
  vi.resetModules()
  return (await import('../supabaseAdmin')).getSupabaseAdmin
}

describe('getSupabaseAdmin', () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY }

  beforeEach(() => {
    process.env.SUPABASE_URL         = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test'
  })

  afterEach(() => {
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_KEY', saved.key]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    vi.restoreAllMocks()
  })

  it('環境変数が揃っていればクライアントを返す', async () => {
    const getSupabaseAdmin = await freshImport()
    expect(getSupabaseAdmin()).not.toBeNull()
  })

  it('環境変数が無ければ null を返し、throw しない', async () => {
    // ここで throw するとサーバーが起動せず、共有キーと無関係な
    // 従来のBYOKユーザーまで止まる
    delete process.env.SUPABASE_SERVICE_KEY
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const getSupabaseAdmin = await freshImport()
    expect(getSupabaseAdmin()).toBeNull()
  })

  it('2回目以降は同じインスタンスを返す（毎リクエスト作り直さない）', async () => {
    const getSupabaseAdmin = await freshImport()
    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin())
  })

  it('null もキャッシュし、警告を繰り返さない', async () => {
    delete process.env.SUPABASE_URL
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const getSupabaseAdmin = await freshImport()
    getSupabaseAdmin()
    getSupabaseAdmin()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
