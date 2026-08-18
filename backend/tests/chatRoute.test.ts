// POST /api/chat のルートテスト。
//
// 検証するのは「共有キーの枠をいつ取り、いつ返し、いつ数えるか」という分岐だけで、
// LLM呼び出し（textService）とプロバイダーは丸ごと差し替える。
// この層でしか見えないのは、reserve → 応答 → consume / release という
// リクエスト1本ぶんのライフサイクル全体である。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import chatRouter from '../routes/chat'
import { withRouter, parseSSE } from './helpers/testServer'
import { SHARED_DAILY_LIMIT, reserveSharedAllowance, consumeSharedQuota, releaseGlobalQuota, sharedApiKey } from '../sharedKey'
import { orchestrateMultiBody } from '../llm/textService'
import { resolveUserId } from '../auth'

vi.mock('../auth', () => ({ resolveUserId: vi.fn() }))
vi.mock('../llm/textService', () => ({ orchestrateMultiBody: vi.fn(), streamBodyOAI: vi.fn() }))

// providers/anthropic.ts はモジュール読み込み時に new Anthropic() を実行し、
// jsdom環境では「ブラウザ相当」と判定されて例外になるため読み込みごと差し替える
vi.mock('../llm/providers/anthropic', () => ({ streamAnthropic: vi.fn() }))
vi.mock('../llm/providers/openaiCompat', () => ({ streamOpenAICompat: vi.fn() }))
vi.mock('../llm/providers/ollama', () => ({ streamOllamaNative: vi.fn(), ollamaEnabled: vi.fn(() => true) }))

// hasOwnCloudKey（純粋な判定）と定数は本物のまま使う
vi.mock('../sharedKey', async (importOriginal) => ({
  ...await importOriginal<typeof import('../sharedKey')>(),
  sharedApiKey:           vi.fn(() => 'sk-ant-shared-operator-key'),
  reserveSharedAllowance: vi.fn(),
  consumeSharedQuota:     vi.fn(),
  releaseGlobalQuota:     vi.fn(),
}))

const NO_OWN_KEY = { messages: [{ role: 'user', content: 'こんにちは' }] }
const OWN_KEY = {
  messages: [{ role: 'user', content: 'こんにちは' }],
  bodies: [
    { provider: 'anthropic', apiKey: 'sk-user-key', model: 'claude-haiku-4-5', name: '一体' },
    { provider: 'anthropic', apiKey: 'sk-user-key', model: 'claude-haiku-4-5', name: '二体' },
  ],
}

async function post(body: unknown) {
  return withRouter(chatRouter, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    return { status: response.status, ...parseSSE(await response.text()) }
  })
}

// 認証は全経路の手前にある。ここが通らないと以降の分岐は1つも評価されない
describe('POST /api/chat — 認証', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reserveSharedAllowance).mockResolvedValue({ allowed: true, remaining: 2 })
  })

  // 未ログインのcurl直叩きでこのサーバーをLLMプロキシとして踏み台にできる状態を塞ぐ。
  // 自分のAPIキーを持っていても通さない
  it('トークンが無ければ 401 を返し、LLMには一切到達しない', async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null)
    const { status } = await post(OWN_KEY)

    expect(status).toBe(401)
    expect(orchestrateMultiBody).not.toHaveBeenCalled()
    expect(reserveSharedAllowance).not.toHaveBeenCalled()
  })

  // SSEヘッダを flush した後ではステータスを変えられない。
  // 401 が実際に返っている＝認証判定がヘッダ送出より前にあることの担保になる
  it('401 は SSE ではなく通常のJSONとして返る', async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null)
    const { status, events, done } = await post(OWN_KEY)

    expect(status).toBe(401)
    expect(events).toHaveLength(0)
    expect(done).toBe(false)
  })
})

describe('POST /api/chat — 共有キーの枠', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserId).mockResolvedValue('user-1')
    vi.mocked(sharedApiKey).mockReturnValue('sk-ant-shared-operator-key')
    vi.mocked(reserveSharedAllowance).mockResolvedValue({ allowed: true, remaining: 2 })
  })

  it('自分のキーが無く許可されていれば、三体で応答し個人枠を1回消費する', async () => {
    const { done } = await post(NO_OWN_KEY)

    expect(orchestrateMultiBody).toHaveBeenCalledOnce()
    expect(done).toBe(true)
    expect(consumeSharedQuota).toHaveBeenCalledWith('user-1')
    // 成功したので予約は返さない
    expect(releaseGlobalQuota).not.toHaveBeenCalled()
  })

  // 共有キー経路の personaPrompt はここで直に組み立てるため、フロントの
  // NO_ARTIFACT（src/constants/bodyPersonas.ts）が届かず素通しになっていた。
  // 運営がトークンを負担する経路でこそ、副体に具体物を書かせたくない
  it('共有キー経路の副体にも「具体物を書くな」が届く', async () => {
    await post(NO_OWN_KEY)

    const [bodies] = vi.mocked(orchestrateMultiBody).mock.calls[0]!
    // 一体（主体）は具体物を出す側なので、この制約を持たない
    expect(bodies[0]!.personaPrompt).toBeUndefined()
    expect(bodies[1]!.personaPrompt).toContain('具体物を作るのは統合役の仕事')
    expect(bodies[2]!.personaPrompt).toContain('具体物を作るのは統合役の仕事')
  })

  // 自分のキーで動くユーザーは運営のコストを一切使わない。
  // ここで予約が走ると、BYOKユーザーがページを使うだけで全体枠が減る
  it('自分のクラウドキーがあれば共有キーの判定自体を行わない', async () => {
    await post(OWN_KEY)

    expect(reserveSharedAllowance).not.toHaveBeenCalled()
    expect(consumeSharedQuota).not.toHaveBeenCalled()
    expect(releaseGlobalQuota).not.toHaveBeenCalled()
  })

  it('個人枠の上限に達していれば limit_reached を返し、LLMを呼ばない', async () => {
    vi.mocked(reserveSharedAllowance).mockResolvedValue({ allowed: false, reason: 'limit_reached' })
    const { events } = await post(NO_OWN_KEY)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'limit_reached' })
    expect(String(events[0]!.message)).toContain(`${SHARED_DAILY_LIMIT}回`)
    expect(orchestrateMultiBody).not.toHaveBeenCalled()
    // 予約が成立していないので返す対象も無い
    expect(releaseGlobalQuota).not.toHaveBeenCalled()
  })

  // 全体枠で止まったユーザーは今日まだ1回も使っていないことがある。
  // 個人枠の文言（「今日の無料利用は3回までです」）を出してはいけない
  it('全体枠が尽きていれば global_limit_reached を返し、個人枠の文言を使わない', async () => {
    vi.mocked(reserveSharedAllowance).mockResolvedValue({ allowed: false, reason: 'global_limit_reached' })
    const { events } = await post(NO_OWN_KEY)

    expect(events[0]).toMatchObject({ type: 'error', code: 'global_limit_reached' })
    expect(String(events[0]!.message)).not.toContain(`${SHARED_DAILY_LIMIT}回`)
    expect(orchestrateMultiBody).not.toHaveBeenCalled()
  })
})

describe('POST /api/chat — 予約の解放', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserId).mockResolvedValue('user-1')
    vi.mocked(sharedApiKey).mockReturnValue('sk-ant-shared-operator-key')
    vi.mocked(reserveSharedAllowance).mockResolvedValue({ allowed: true, remaining: 2 })
  })

  // 予約したまま返さないと、プロバイダー障害が続く日に「誰にも届かないまま
  // 全体枠だけが尽きる」状態になる
  it('LLMが失敗したら全体枠を返し、個人枠は消費しない', async () => {
    vi.mocked(orchestrateMultiBody).mockRejectedValue(new Error('provider down'))
    const { events, done } = await post(NO_OWN_KEY)

    expect(releaseGlobalQuota).toHaveBeenCalledOnce()
    expect(consumeSharedQuota).not.toHaveBeenCalled()
    expect(done).toBe(false)
    expect(events[0]).toMatchObject({ type: 'error' })
  })

  // 予約は取れたが共有キーが読めない（環境変数が消えた等）ケース。
  // 処理はそのまま従来経路（Ollama等）へ落ちて完了しうるが、共有キーは1トークンも
  // 使っていないので枠は返さなければならない。completed だけで判定すると取りこぼす
  it('予約後に共有キーが取得できず、別経路で完了した場合も全体枠を返す', async () => {
    vi.mocked(sharedApiKey).mockReturnValue(null)
    const { done } = await post(NO_OWN_KEY)

    expect(orchestrateMultiBody).not.toHaveBeenCalled()
    expect(done).toBe(true)                              // 応答自体は完了している
    expect(consumeSharedQuota).not.toHaveBeenCalled()    // 共有キーは使っていない
    expect(releaseGlobalQuota).toHaveBeenCalledOnce()    // よって予約は返す
  })

  it('BYOK経路でLLMが失敗しても、そもそも予約が無いので解放しない', async () => {
    vi.mocked(orchestrateMultiBody).mockRejectedValue(new Error('provider down'))
    await post(OWN_KEY)

    expect(releaseGlobalQuota).not.toHaveBeenCalled()
  })
})
