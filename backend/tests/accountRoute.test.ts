// DELETE /api/account のルートテスト。
//
// 退会は取り消せない操作なので、「消え残る」と「消しすぎる」の両方が事故になる。
// このファイルが守っているのは主に順序：アカウント本体（auth.users）を消すのは
// 必ず最後で、その手前でデータ削除に失敗したら本体を消さないこと。
// 逆順にすると、途中で失敗したときに「ログインできないのにデータは残る」——
// 本人にも運営にも消せない状態になる。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import accountRouter, { deleteRateLimit } from '../routes/account'
import { withRouter } from './helpers/testServer'
import { resolveUserId } from '../auth'
import { getSupabaseAdmin } from '../supabaseAdmin'

vi.mock('../auth', () => ({ resolveUserId: vi.fn() }))
vi.mock('../supabaseAdmin', () => ({ getSupabaseAdmin: vi.fn() }))

// Supabaseのクエリビルダのうち、このルートが実際に使う形だけを模す。
// from(t).select().eq() / from(t).select().in() / from(t).delete().eq() / from(t).delete().in()
// はいずれも { data, error } に解決する。呼ばれた順序を calls に積む
function makeAdminClient(failOn?: string) {
  const calls: string[] = []
  const rows: Record<string, { id: string }[]> = {
    conversations: [{ id: 'c1' }, { id: 'c2' }],
    messages:      [{ id: 'm1' }],
  }

  function step(table: string, op: 'select' | 'delete') {
    const key = `${op}:${table}`
    calls.push(key)
    if (failOn === key) return Promise.resolve({ data: null, error: { message: 'boom' } })
    return Promise.resolve({ data: op === 'select' ? (rows[table] ?? []) : null, error: null })
  }

  function builder(table: string, op: 'select' | 'delete') {
    return { eq: () => step(table, op), in: () => step(table, op) }
  }

  const deleteUser = vi.fn(() => {
    calls.push('auth.deleteUser')
    return Promise.resolve({ error: null })
  })

  return {
    calls,
    deleteUser,
    client: {
      from: (table: string) => ({
        select: () => builder(table, 'select'),
        delete: () => builder(table, 'delete'),
      }),
      auth: { admin: { deleteUser } },
    },
  }
}

async function del(): Promise<Response> {
  return withRouter(accountRouter, async (baseUrl) =>
    fetch(`${baseUrl}/api/account`, { method: 'DELETE' })
  )
}

describe('DELETE /api/account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // レート制限はIP単位のモジュールレベルの状態で、テスト間に持ち越される。
    // リセットしないと5件目以降のテストが 429 で落ちる
    deleteRateLimit.resetKey('::ffff:127.0.0.1')
    deleteRateLimit.resetKey('127.0.0.1')
    vi.mocked(resolveUserId).mockResolvedValue('user-1')
  })

  it('認証できないリクエストは401で、Supabaseには一切触らない', async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null)
    const res = await del()
    expect(res.status).toBe(401)
    expect(getSupabaseAdmin).not.toHaveBeenCalled()
  })

  it('service_role が使えない環境では503を返す（500だと一時的な不具合に見える）', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null)
    const res = await del()
    expect(res.status).toBe(503)
  })

  it('子から親の順に消し、アカウント本体は最後に消す', async () => {
    const admin = makeAdminClient()
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin.client as never)

    const res = await del()
    expect(res.status).toBe(204)

    expect(admin.calls).toEqual([
      'select:conversations',
      'select:messages',
      'delete:content_blocks',
      'delete:messages',
      'delete:conversations',
      'delete:feedback',
      'delete:user_setting',
      'auth.deleteUser',
    ])
  })

  it('データ削除の途中で失敗したら、アカウント本体は消さない', async () => {
    const admin = makeAdminClient('delete:messages')
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin.client as never)

    const res = await del()
    expect(res.status).toBe(500)
    expect(admin.deleteUser).not.toHaveBeenCalled()
    // 失敗地点より後ろへは進まない
    expect(admin.calls).not.toContain('delete:user_setting')
  })
})
