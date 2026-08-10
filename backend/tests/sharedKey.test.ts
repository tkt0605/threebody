import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  hasOwnCloudKey, sharedApiKey, checkSharedAllowance, consumeSharedQuota,
  SHARED_DAILY_LIMIT, GLOBAL_SHARED_DAILY_LIMIT,
} from '../sharedKey'
import { jstDateString } from '../utils/jstDate'
import { getSupabaseAdmin } from '../supabaseAdmin'

vi.mock('../supabaseAdmin', () => ({ getSupabaseAdmin: vi.fn() }))

const KEY = 'sk-ant-shared-operator-key-0123456789'

type QuotaRow = {
  can_use_shared_key:    boolean | null
  shared_daily_count:    number  | null
  shared_last_used_date: string  | null
}

// checkSharedAllowance が使うのは .from().select().eq().maybeSingle()、
// （行が無い場合のみ）.from().upsert().select().maybeSingle()、
// そして最後に .rpc('try_reserve_global_quota', ...)。
// consumeSharedQuota が使うのは .rpc('consume_shared_quota', ...) だけ。
// rpc は呼ばれる関数名で応答を出し分ける（片方だけ差し替えたいテストがあるため）
function fakeAdmin(opts: {
  row?: QuotaRow | null
  selectError?: { message: string } | null
  rpcError?: { message: string } | null
  upsertRow?: QuotaRow | null
  upsertError?: { message: string } | null
  // try_reserve_global_quota の戻り値。既定は true（＝全体上限にはまだ余裕がある）にして、
  // 個人枠のテストがこれで足を取られないようにする
  globalReserved?: boolean
  globalReserveError?: { message: string } | null
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data:  opts.row ?? null,
    error: opts.selectError ?? null,
  })
  const eq     = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })

  const upsertMaybeSingle = vi.fn().mockResolvedValue({
    data:  opts.upsertRow ?? null,
    error: opts.upsertError ?? null,
  })
  const upsertSelect = vi.fn().mockReturnValue({ maybeSingle: upsertMaybeSingle })
  const upsert        = vi.fn().mockReturnValue({ select: upsertSelect })

  const rpc = vi.fn().mockImplementation((fn: string) => {
    if (fn === 'try_reserve_global_quota') {
      return Promise.resolve({
        data:  opts.globalReserveError ? null : (opts.globalReserved ?? true),
        error: opts.globalReserveError ?? null,
      })
    }
    return Promise.resolve({ data: null, error: opts.rpcError ?? null })
  })
  return { from: vi.fn().mockReturnValue({ select, upsert }), rpc, upsert }
}

describe('hasOwnCloudKey', () => {
  it('クラウド系でキーとモデルが揃っていれば「設定済み」', () => {
    expect(hasOwnCloudKey({
      bodies: [{ provider: 'anthropic', apiKey: 'sk-user-key', model: 'claude-opus-5' }],
    })).toBe(true)
  })

  it('ollama だけでは「未設定」', () => {
    // server.ts の available フィルタは ollama を無条件 true にするため、
    // available.length === 0 では未設定を検出できない。ここがその代わり
    expect(hasOwnCloudKey({
      bodies: [
        { provider: 'ollama',   apiKey: '',  model: '' },
        { provider: 'openai',   apiKey: '',  model: '' },
        { provider: 'deepseek', apiKey: '',  model: '' },
      ],
    })).toBe(false)
  })

  it('キーだけ・モデルだけでは「未設定」', () => {
    // 片方だけではAPIを呼べない。呼べない設定を「設定済み」と数えると、
    // 共有キーに落ちずにそのまま失敗する
    expect(hasOwnCloudKey({ bodies: [{ provider: 'openai', apiKey: 'sk-x', model: '' }] })).toBe(false)
    expect(hasOwnCloudKey({ bodies: [{ provider: 'openai', apiKey: '', model: 'gpt-x' }] })).toBe(false)
  })

  it('空白だけの値は未設定として扱う', () => {
    expect(hasOwnCloudKey({ bodies: [{ provider: 'openai', apiKey: '  ', model: '  ' }] })).toBe(false)
  })

  it('単体モード（provider/model/apiKey 直指定）も見る', () => {
    expect(hasOwnCloudKey({ provider: 'deepseek', apiKey: 'sk-x', model: 'deepseek-chat' })).toBe(true)
    expect(hasOwnCloudKey({ provider: 'ollama',   apiKey: '',     model: 'gemma' })).toBe(false)
  })

  it('bodies も直指定も無ければ未設定', () => {
    expect(hasOwnCloudKey({})).toBe(false)
  })

  it('3体のうち1つでも揃っていれば設定済み', () => {
    expect(hasOwnCloudKey({
      bodies: [
        { provider: 'ollama', apiKey: '', model: '' },
        { provider: 'openai', apiKey: '', model: '' },
        { provider: 'anthropic', apiKey: 'sk-user', model: 'claude-sonnet-5' },
      ],
    })).toBe(true)
  })
})

describe('sharedApiKey / checkSharedAllowance', () => {
  const saved = process.env.SHARED_ANTHROPIC_API_KEY

  beforeEach(() => { process.env.SHARED_ANTHROPIC_API_KEY = KEY })
  afterEach(() => {
    if (saved === undefined) delete process.env.SHARED_ANTHROPIC_API_KEY
    else process.env.SHARED_ANTHROPIC_API_KEY = saved
    vi.restoreAllMocks()
  })

  it('環境変数から共有キーを読む', () => {
    expect(sharedApiKey()).toBe(KEY)
  })

  it('未設定・空白のみなら null', () => {
    delete process.env.SHARED_ANTHROPIC_API_KEY
    expect(sharedApiKey()).toBeNull()
    process.env.SHARED_ANTHROPIC_API_KEY = '   '
    expect(sharedApiKey()).toBeNull()
  })

  it('共有キーが無ければ DB を見ずに unavailable', async () => {
    delete process.env.SHARED_ANTHROPIC_API_KEY
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'unavailable' })
  })

  it('未ログイン（userId が null）なら not_signed_in', async () => {
    // 誰の割当かを決められない。ここを許可に倒すと無認証で使い放題になる
    await expect(checkSharedAllowance(null)).resolves.toEqual({ allowed: false, reason: 'not_signed_in' })
  })

  it('Supabase未設定（getSupabaseAdmin が null）なら DB を見ずに unavailable', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'unavailable' })
  })

  it('行の取得に失敗したら not_permitted（許可に倒さない）', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({ selectError: { message: 'boom' } }) as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  it('行が無ければservice roleで自動作成を試み、作成した行のcan_use_shared_keyがfalseならnot_permitted', async () => {
    const admin = fakeAdmin({
      row: null,
      upsertRow: { can_use_shared_key: false, shared_daily_count: 0, shared_last_used_date: null },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
    // idのみでupsertする（can_use_shared_key等はテーブルdefaultに委ねる）
    expect(admin.upsert).toHaveBeenCalledWith({ id: 'user-1' })
  })

  it('行の自動作成にも失敗したら not_permitted', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({ row: null, upsertRow: null }) as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  it('行が無く、自動作成した行のcan_use_shared_keyがtrueなら許可される（招待制反転後の想定挙動）', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: null,
      upsertRow: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(checkSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })

  it('行が既にあれば自動作成（upsert）は呼ばない', async () => {
    const admin = fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await checkSharedAllowance('user-1')
    expect(admin.upsert).not.toHaveBeenCalled()
  })

  it('can_use_shared_key が false なら not_permitted', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: false, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  it('今日まだ使っていなければ残り枠は上限いっぱい', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(checkSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })

  it('上限ちょうどに達していたら limit_reached', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT,
        shared_last_used_date: jstDateString(),
      },
    }) as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'limit_reached' })
  })

  it('上限の1つ手前なら残り1で許可', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT - 1,
        shared_last_used_date: jstDateString(),
      },
    }) as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: true, remaining: 1 })
  })

  it('個人枠が残っていても、全体上限の予約に失敗すれば limit_reached', async () => {
    const admin = fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalReserved: false,
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'limit_reached' })
    expect(admin.rpc).toHaveBeenCalledWith('try_reserve_global_quota', {
      p_today: jstDateString(),
      p_limit: GLOBAL_SHARED_DAILY_LIMIT,
    })
  })

  it('全体上限の予約RPC自体が失敗しても許可に倒さない', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalReserveError: { message: 'boom' },
    }) as never)
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'limit_reached' })
  })

  it('個人枠が上限に達していれば、全体上限の予約はしない（無駄な消費を避ける）', async () => {
    const admin = fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT,
        shared_last_used_date: jstDateString(),
      },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await checkSharedAllowance('user-1')
    expect(admin.rpc).not.toHaveBeenCalledWith('try_reserve_global_quota', expect.anything())
  })

  it('日付が変わっていれば古いカウントを無視してリセット扱いにする', async () => {
    // 昨日時点で上限に達していても、日を跨いでいれば今日はまだ0回扱い
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT,
        shared_last_used_date: '2000-01-01',
      },
    }) as never)
    await expect(checkSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })
})

describe('consumeSharedQuota', () => {
  afterEach(() => vi.restoreAllMocks())

  it('Supabase未設定なら何もせず静かに戻る', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null)
    await expect(consumeSharedQuota('user-1')).resolves.toBeUndefined()
  })

  it('今日の日付で consume_shared_quota RPC を呼ぶ', async () => {
    const admin = fakeAdmin()
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)

    await consumeSharedQuota('user-1')

    expect(admin.rpc).toHaveBeenCalledWith('consume_shared_quota', {
      p_user_id: 'user-1',
      p_today:   jstDateString(),
    })
  })

  it('RPCが失敗しても throw せず、ログに残すだけ', async () => {
    const admin = fakeAdmin({ rpcError: { message: 'db down' } })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(consumeSharedQuota('user-1')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('利用回数の記録に失敗しました'),
      'db down',
    )
  })
})
