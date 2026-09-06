import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_TIMEOUT_MS, searchEnabled, searchWeb } from '../tools/webSearch'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('副体のWeb検索', () => {
  it('URL未設定なら無効でfetchしない', async () => {
    vi.stubEnv('SEARCH_API_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(searchEnabled()).toBeNull()
    expect(await searchWeb('主張')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SearXNGを上位3件へ整形し、snippetを300字に制限する', async () => {
    vi.stubEnv('SEARCH_API_URL', 'https://search.example/search')
    vi.stubEnv('SEARCH_API_KEY', '')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [
      { title: '不正', url: 'javascript:alert(1)', content: '無効' },
      ...Array.from({ length: 4 }, (_, i) => ({ title: `資料${i}`, url: `https://example.com/${i}`, content: 'あ'.repeat(400) })),
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(searchEnabled()).toBe(true)
    const hits = await searchWeb('日本語 & 主張')
    expect(hits).toHaveLength(3)
    expect(hits[0]).toEqual({ title: '資料0', url: 'https://example.com/0', snippet: 'あ'.repeat(300) })
    const [url, opts] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.searchParams.get('q')).toBe('日本語 & 主張')
    expect(url.searchParams.get('format')).toBe('json')
    expect(opts.headers).toEqual({ Accept: 'application/json' })
  })

  it('Braveの認証ヘッダとweb.resultsを扱う', async () => {
    vi.stubEnv('SEARCH_API_URL', 'https://api.search.brave.com/res/v1/web/search')
    vi.stubEnv('SEARCH_API_KEY', 'search-secret')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ web: { results: [
      { title: '資料', url: 'https://example.com/', description: '抜粋' },
    ] } }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await searchWeb('主張')).toEqual([{ title: '資料', url: 'https://example.com/', snippet: '抜粋' }])
    const [url, opts] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.searchParams.get('count')).toBe('3')
    expect(url.toString()).not.toContain('search-secret')
    expect(opts.headers).toMatchObject({ 'X-Subscription-Token': 'search-secret' })
  })

  it('タイムアウトで中断してrejectする', async () => {
    vi.useFakeTimers()
    vi.stubEnv('SEARCH_API_URL', 'https://search.example/search')
    vi.stubGlobal('fetch', vi.fn((_url: URL, opts: RequestInit) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    })))
    const check = expect(searchWeb('主張')).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS)
    await check
  })

  it('HTTPエラーの本文を漏らさない', async () => {
    vi.stubEnv('SEARCH_API_URL', 'https://search.example/search')
    const body = vi.fn().mockResolvedValue('secret-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: body }))
    await expect(searchWeb('主張')).rejects.toThrow('検索APIがHTTP 401を返しました')
    expect(body).not.toHaveBeenCalled()
  })

  it('未知のJSON形式は空の検索成功として扱わない', async () => {
    vi.stubEnv('SEARCH_API_URL', 'https://search.example/search')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'invalid' }) }))
    await expect(searchWeb('主張')).rejects.toThrow('results')
  })
})
