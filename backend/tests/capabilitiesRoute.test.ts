// GET /api/capabilities のルートテスト。
//
// このエンドポイントは「表示のためだけ」の読み取り経路であり、フロントはページを開くたび
// （ChatView.vue の watch(user.id, ..., immediate)）と応答完了ごと（useChat.ts の
// refreshCapabilities）に叩く。ここが予約側（reserveSharedAllowance）を呼ぶと、
// LLMを一度も呼ばないままリロードだけで全体枠を食い潰す——という不具合が実際に本番で
// 起きた。その回帰をルートの層で止めるのがこのファイルの主目的。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import capabilitiesRouter from '../routes/capabilities'
import { withRouter } from './helpers/testServer'
import { SHARED_DAILY_LIMIT, peekSharedAllowance, reserveSharedAllowance } from '../sharedKey'
import { resolveUserId } from '../auth'

vi.mock('../auth', () => ({ resolveUserId: vi.fn() }))
vi.mock('../llm/providers/ollama', () => ({ ollamaEnabled: vi.fn(() => true) }))

// 上限値などの定数は本物を使い、判定関数だけ差し替える
vi.mock('../sharedKey', async (importOriginal) => ({
  ...await importOriginal<typeof import('../sharedKey')>(),
  peekSharedAllowance:    vi.fn(),
  reserveSharedAllowance: vi.fn(),
}))

type CapabilitiesResponse = {
  sharedKey: { allowed: boolean; remaining: number; dailyLimit: number; reason: string | null }
  ollama:    { enabled: boolean }
}

async function get(): Promise<CapabilitiesResponse> {
  return withRouter(capabilitiesRouter, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities`)
    expect(response.status).toBe(200)
    return await response.json() as CapabilitiesResponse
  })
}

describe('GET /api/capabilities', () => {
  beforeEach(() => {
    vi.mocked(resolveUserId).mockResolvedValue('user-1')
    vi.mocked(peekSharedAllowance).mockResolvedValue({ allowed: true, remaining: 2 })
  })

  // 回帰テスト本体
  it('予約する側（reserveSharedAllowance）を絶対に呼ばない', async () => {
    await get()
    expect(peekSharedAllowance).toHaveBeenCalledWith('user-1')
    expect(reserveSharedAllowance).not.toHaveBeenCalled()
  })

  it('許可されていれば残り回数と上限を返す', async () => {
    const body = await get()
    expect(body.sharedKey).toEqual({
      allowed: true, remaining: 2, dailyLimit: SHARED_DAILY_LIMIT, reason: null,
    })
  })

  it('不許可なら remaining を 0 にし、理由をそのまま渡す', async () => {
    vi.mocked(peekSharedAllowance).mockResolvedValue({ allowed: false, reason: 'not_permitted' })
    const body = await get()
    expect(body.sharedKey).toEqual({
      allowed: false, remaining: 0, dailyLimit: SHARED_DAILY_LIMIT, reason: 'not_permitted',
    })
  })

  // 個人枠と全体枠はフロントで文言を出し分けるため、丸めずに素通しする必要がある
  it('global_limit_reached を limit_reached に丸めずそのまま返す', async () => {
    vi.mocked(peekSharedAllowance).mockResolvedValue({ allowed: false, reason: 'global_limit_reached' })
    const body = await get()
    expect(body.sharedKey.reason).toBe('global_limit_reached')
  })

  it('未ログイン（userId が null）でも判定関数まで到達する', async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null)
    vi.mocked(peekSharedAllowance).mockResolvedValue({ allowed: false, reason: 'not_signed_in' })

    const body = await get()
    expect(peekSharedAllowance).toHaveBeenCalledWith(null)
    expect(body.sharedKey.reason).toBe('not_signed_in')
  })
})
