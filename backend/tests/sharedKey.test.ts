import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  hasOwnCloudKey, sharedApiKey, peekSharedAllowance, reserveSharedAllowance, consumeSharedQuota,
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

// peekSharedAllowance が使うのは user_setting への .select().eq().maybeSingle()、
// （行が無い場合のみ）.upsert().select().maybeSingle()、そして
// shared_key_global_usage への .select().eq().maybeSingle()（読むだけ・予約しない）。
// reserveSharedAllowance はそれに加えて最後に .rpc('try_reserve_global_quota', ...) を呼ぶ。
// consumeSharedQuota が使うのは .rpc('consume_shared_quota', ...) だけ。
//
// from はテーブル名で、rpc は関数名で応答を出し分ける（片方だけ差し替えたいテストがあるため）
function fakeAdmin(opts: {
  row?: QuotaRow | null
  selectError?: { message: string } | null
  rpcError?: { message: string } | null
  upsertRow?: QuotaRow | null
  upsertError?: { message: string } | null
  // shared_key_global_usage の今日の行。既定は0回（＝全体枠に余裕がある）。
  // null は「今日の行がまだ無い」＝誰も使っていない状態を表す
  globalUsed?: number | null
  globalUsageError?: { message: string } | null
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

  const usageMaybeSingle = vi.fn().mockResolvedValue({
    data:  opts.globalUsed === undefined ? { count: 0 } : (opts.globalUsed === null ? null : { count: opts.globalUsed }),
    error: opts.globalUsageError ?? null,
  })
  const usageSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: usageMaybeSingle }) })

  const rpc = vi.fn().mockImplementation((fn: string) => {
    if (fn === 'try_reserve_global_quota') {
      return Promise.resolve({
        data:  opts.globalReserveError ? null : (opts.globalReserved ?? true),
        error: opts.globalReserveError ?? null,
      })
    }
    return Promise.resolve({ data: null, error: opts.rpcError ?? null })
  })

  const from = vi.fn().mockImplementation((table: string) =>
    table === 'shared_key_global_usage' ? { select: usageSelect } : { select, upsert })

  return { from, rpc, upsert, usageSelect }
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

describe('sharedApiKey / reserveSharedAllowance（判定＋全体枠の予約）', () => {
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
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'unavailable' })
  })

  it('未ログイン（userId が null）なら not_signed_in', async () => {
    // 誰の割当かを決められない。ここを許可に倒すと無認証で使い放題になる
    await expect(reserveSharedAllowance(null)).resolves.toEqual({ allowed: false, reason: 'not_signed_in' })
  })

  it('Supabase未設定（getSupabaseAdmin が null）なら DB を見ずに unavailable', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null)
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'unavailable' })
  })

  it('行の取得に失敗したら not_permitted（許可に倒さない）', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({ selectError: { message: 'boom' } }) as never)
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  it('行が無ければservice roleで自動作成を試み、作成した行のcan_use_shared_keyがfalseならnot_permitted', async () => {
    const admin = fakeAdmin({
      row: null,
      upsertRow: { can_use_shared_key: false, shared_daily_count: 0, shared_last_used_date: null },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
    // idのみでupsertする（can_use_shared_key等はテーブルdefaultに委ねる）
    expect(admin.upsert).toHaveBeenCalledWith({ id: 'user-1' })
  })

  it('行の自動作成にも失敗したら not_permitted', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({ row: null, upsertRow: null }) as never)
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  // Phase 1 Step 3 で can_use_shared_key の既定を true に反転したため、これが通常の経路。
  // 新規ユーザーの初回メッセージ（＝まだ user_setting の行が無い）がそのまま通る
  it('行が無くても、自動作成した行が既定のtrueなら許可される', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: null,
      upsertRow: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(reserveSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })

  it('行が既にあれば自動作成（upsert）は呼ばない', async () => {
    const admin = fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await reserveSharedAllowance('user-1')
    expect(admin.upsert).not.toHaveBeenCalled()
  })

  // 既定が true になった後の false は「運営が明示的に停止した」を意味する（ブロックリスト方式）
  it('can_use_shared_key が false なら not_permitted（明示的に停止されたアカウント）', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: false, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  it('今日まだ使っていなければ残り枠は上限いっぱい', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(reserveSharedAllowance('user-1'))
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
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'limit_reached' })
  })

  it('上限の1つ手前なら残り1で許可', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT - 1,
        shared_last_used_date: jstDateString(),
      },
    }) as never)
    await expect(reserveSharedAllowance('user-1')).resolves.toEqual({ allowed: true, remaining: 1 })
  })

  // 個人枠（limit_reached）と混同しないこと。このユーザーは今日まだ0回しか使っていない
  it('個人枠が残っていても、全体上限の予約に失敗すれば global_limit_reached', async () => {
    const admin = fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalReserved: false,
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)
    await expect(reserveSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: false, reason: 'global_limit_reached' })
    expect(admin.rpc).toHaveBeenCalledWith('try_reserve_global_quota', {
      p_today: jstDateString(),
      p_limit: GLOBAL_SHARED_DAILY_LIMIT,
    })
  })

  // peek の select が上限未満を返した直後に他のリクエストが枠を取り切った場合、
  // 最後に止められるのは予約RPCだけ。ここが判定の正本であることを固定する
  it('peekが通しても、予約RPCが false を返せば global_limit_reached', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalUsed: 0,
      globalReserved: false,
    }) as never)
    await expect(reserveSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: false, reason: 'global_limit_reached' })
  })

  it('全体上限の予約RPC自体が失敗しても許可に倒さない', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalReserveError: { message: 'boom' },
    }) as never)
    await expect(reserveSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: false, reason: 'global_limit_reached' })
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
    await reserveSharedAllowance('user-1')
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
    await expect(reserveSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })
})

// 表示用の GET /api/capabilities が呼ぶ側。副作用が無いことがこの関数の存在理由なので、
// 「予約しない」ことをテストの中心に置く
describe('peekSharedAllowance（判定のみ・全体枠を消費しない）', () => {
  const saved = process.env.SHARED_ANTHROPIC_API_KEY

  beforeEach(() => { process.env.SHARED_ANTHROPIC_API_KEY = KEY })
  afterEach(() => {
    if (saved === undefined) delete process.env.SHARED_ANTHROPIC_API_KEY
    else process.env.SHARED_ANTHROPIC_API_KEY = saved
    vi.restoreAllMocks()
  })

  // 回帰テスト本体。ここが破れると、ユーザーがページを開き直すだけで全体枠が減り、
  // LLMを一度も呼ばないまま1日50回のキルスイッチが落ちる
  it('許可を返すときも全体上限の予約RPCを呼ばない', async () => {
    const admin = fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)

    await expect(peekSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('個人枠の判定は reserve と同じ（上限に達していれば limit_reached）', async () => {
    const admin = fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT,
        shared_last_used_date: jstDateString(),
      },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)

    await expect(peekSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'limit_reached' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('停止中のアカウントは not_permitted', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: false, shared_daily_count: 0, shared_last_used_date: null },
    }) as never)
    await expect(peekSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'not_permitted' })
  })

  // 行の自動作成は peek 側にも残す。表示のためのポーリングが結果的に user_setting の行を
  // 先に作るため、persistMessage（fire-and-forget）との競合に対する保険にもなっている
  it('行が無ければ自動作成し、既定のtrueなら許可を返す', async () => {
    const admin = fakeAdmin({
      row: null,
      upsertRow: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)

    await expect(peekSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
    expect(admin.upsert).toHaveBeenCalledWith({ id: 'user-1' })
  })

  // 全体枠は「予約せずに読むだけ」で確認する。これが無いと、全体上限に達した日でも
  // UIは「残り3回」と表示し続け、送信して初めて弾かれることになる
  it('全体消費数が上限に達していれば global_limit_reached（予約はしない）', async () => {
    const admin = fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalUsed: GLOBAL_SHARED_DAILY_LIMIT,
    })
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never)

    await expect(peekSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: false, reason: 'global_limit_reached' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('全体消費数が上限の1つ手前ならまだ許可', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalUsed: GLOBAL_SHARED_DAILY_LIMIT - 1,
    }) as never)
    await expect(peekSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })

  it('今日の行がまだ無ければ0回として扱う', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalUsed: null,
    }) as never)
    await expect(peekSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })

  // 表示専用の経路なので、ここだけは安全側（不許可）に倒さない。実際に止めるのは
  // 予約側の責任であり、一時的な読み取り失敗で「使えません」と誤って伝えないため
  it('全体消費数を読めなかった場合は表示を楽観側に倒す', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: { can_use_shared_key: true, shared_daily_count: 0, shared_last_used_date: null },
      globalUsageError: { message: 'boom' },
    }) as never)
    await expect(peekSharedAllowance('user-1'))
      .resolves.toEqual({ allowed: true, remaining: SHARED_DAILY_LIMIT })
  })

  // 個人枠が尽きている日は、全体枠の状態に関わらず個人枠を伝える
  // （そのユーザーにとっては「自分が使い切った」ほうが事実として近い）
  it('個人枠と全体枠の両方が尽きていれば個人枠（limit_reached）を優先する', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({
      row: {
        can_use_shared_key:    true,
        shared_daily_count:    SHARED_DAILY_LIMIT,
        shared_last_used_date: jstDateString(),
      },
      globalUsed: GLOBAL_SHARED_DAILY_LIMIT,
    }) as never)
    await expect(peekSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'limit_reached' })
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
