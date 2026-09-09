import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PerspectiveBlock, TextBlock } from '../../types/message'

// 【このテストが押さえているもの】
// 共有していないメッセージへ、公開側のコードから到達できないこと。
//
// RLS そのものは Postgres の中にあるのでここでは動かない。代わりに、
//   1. クライアント側 — 公開スナップショット以外のテーブルを読まないこと
//   2. サーバー側 — published_turns の取り消し済み行は見えないこと
// の2つを、下の偽 supabase が RLS と同じ条件を再現して確かめる。
// 本物のポリシーの検証は scripts/verify-share-rls.mjs（実プロジェクトへ接続する）。

type Row = Record<string, unknown>

const db = {
  shared_messages: [] as Row[],
  published_turns: [] as Row[],
  messages:        [] as Row[],
  content_blocks:  [] as Row[],
}

// 匿名閲覧が公開スナップショット1回だけに閉じていることを見る
const selects: { table: string; columns: string }[] = []

function builder(table: string) {
  const filters: Row = {}
  let mode: 'select' | 'insert' | 'update' = 'select'
  let payload: Row = {}

  function rows(): Row[] {
    if (mode === 'insert') {
      const inserted = { token: 'token-new', revoked_at: null, ...payload }
      db.shared_messages.push(inserted)
      return [inserted]
    }

    if (mode === 'update') {
      const hit = db.shared_messages.filter(r => r.token === filters.token)
      hit.forEach(r => Object.assign(r, payload))
      return hit
    }
    // select。published_turns のRLSと同じく、取り消し済みの公開行は見せない
    let source = db[table as keyof typeof db]
    if (table === 'published_turns') source = source.filter(r => r.revoked_at == null)
    return source.filter(r =>
      Object.entries(filters).every(([key, want]) =>
        key.endsWith('__in')
          ? (want as string[]).includes(r[key.slice(0, -4)] as string)
          : r[key] === want
      )
    )
  }

  // 生きている共有は1メッセージにつき1件（部分ユニーク index）。本物と同じく
  // 一意制約違反（23505）を返す
  function conflicts(): boolean {
    return mode === 'insert' && table === 'shared_messages'
      && db.shared_messages.some(r => r.revoked_at == null && r.message_id === payload.message_id)
  }

  const result = () => conflicts()
    ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    : { data: rows(), error: null }

  const api = {
    select: (columns = '*') => { selects.push({ table, columns }); return api },
    insert: (row: Row) => { mode = 'insert'; payload = row; return api },
    update: (row: Row) => { mode = 'update'; payload = row; return api },
    eq: (col: string, val: unknown) => { filters[col] = val; return api },
    is: (col: string, val: unknown) => { filters[col] = val; return api },
    in: (col: string, vals: unknown[]) => { filters[`${col}__in`] = vals; return api },
    order: () => api,
    single: () => { const r = result(); return Promise.resolve({ ...r, data: r.data?.[0] ?? null }) },
    maybeSingle: () => { const r = result(); return Promise.resolve({ ...r, data: r.data?.[0] ?? null }) },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return api
}

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => builder(table) },
}))

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { value: { id: 'user-1' } } }),
}))

const { useSharedTurn, shareUrl } = await import('../useSharedTurn')

const ANSWER_BLOCKS = [
  { type: 'text', payload: { content: '答えの本文' }, sort_order: 0 },
  {
    type: 'perspective',
    payload: { bodies: [{ bodyIndex: 1, name: '崩れる点', provider: 'ollama', content: '出典が未確認', done: false, hasFinding: true }] },
    sort_order: 1,
  },
]

function seed() {
  db.messages = [
    { id: 'q-1', role: 'user',      content: '共有したターンの問い' },
    { id: 'a-1', role: 'assistant', content: '答えの本文' },
    { id: 'q-2', role: 'user',      content: '共有していないターンの問い' },
    { id: 'a-2', role: 'assistant', content: '共有していない答え' },
  ]
  db.content_blocks = ANSWER_BLOCKS.map((block, index) => ({
    id: `b-${index}`,
    message_id: 'a-1',
    ...block,
  }))
  db.shared_messages = [
    { token: 'live-token', message_id: 'a-1', question_message_id: 'q-1', user_id: 'user-1', created_at: '2026-08-21T00:00:00Z', revoked_at: null },
  ]
  db.published_turns = [
    {
      token: 'live-token',
      question: '共有したターンの問い',
      answer: '答えの本文',
      content_blocks: ANSWER_BLOCKS,
      created_at: '2026-08-21T00:00:00Z',
      revoked_at: null,
    },
  ]
}

describe('useSharedTurn', () => {
  beforeEach(() => {
    seed()
    selects.length = 0
    useSharedTurn().liveTokens.value = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('トークンから、問い・答え・検算カードを読み出す', async () => {
    const turn = await useSharedTurn().fetchByToken('live-token')

    expect(turn?.question).toBe('共有したターンの問い')
    expect((turn?.blocks[0] as TextBlock).content).toBe('答えの本文')
    const cards = turn?.blocks[1] as PerspectiveBlock
    expect(cards.bodies[0]!.name).toBe('崩れる点')
    // 読み戻したカードは生成済み。done を立て直さないとカーソルが点滅し続ける
    expect(cards.bodies[0]!.done).toBe(true)
    expect(cards.bodies[0]!.hasFinding).toBe(true)
  })

  // 完了判定そのもの。共有していないメッセージのIDを直接叩いても読めない
  it('共有していないメッセージのIDでは何も取れない', async () => {
    expect(await useSharedTurn().fetchByToken('a-2')).toBeNull()
    expect(await useSharedTurn().fetchByToken('q-2')).toBeNull()

    expect(selects).toHaveLength(2)
    expect(selects.every(query => query.table === 'published_turns')).toBe(true)
  })

  it('取り消し済みの公開スナップショットは読めない', async () => {
    db.published_turns[0]!.revoked_at = '2026-09-09T00:00:00Z'
    expect(await useSharedTurn().fetchByToken('live-token')).toBeNull()
  })

  it('公開を取り消しても管理台帳の行は削除しない', async () => {
    await useSharedTurn().share('a-1', 'q-1')

    expect(await useSharedTurn().revoke('a-1')).toBe(true)
    expect(db.shared_messages).toHaveLength(1)
    expect(db.shared_messages[0]!.revoked_at).not.toBeNull()
  })

  it('公開スナップショットの表示列だけを1回で読む', async () => {
    await useSharedTurn().fetchByToken('live-token')

    expect(selects).toEqual([{
      table: 'published_turns',
      columns: 'token, question, answer, content_blocks, created_at',
    }])
  })

  it('古い共有に検算行が無くても、answerから本文を復元する', async () => {
    db.published_turns[0]!.content_blocks = []

    const turn = await useSharedTurn().fetchByToken('live-token')

    expect(turn?.blocks).toEqual([{ type: 'text', content: '答えの本文' }])
  })

  it('公開すると台帳に1行増え、問いのIDも一緒に記録する', async () => {
    db.shared_messages = []
    const token = await useSharedTurn().share('a-9', 'q-9')

    expect(token).toBe('token-new')
    expect(db.shared_messages[0]).toMatchObject({
      message_id: 'a-9', question_message_id: 'q-9', user_id: 'user-1',
    })
  })

  // 手元の liveTokens が空でも（別タブ・別端末で共有済み）、URLは1つのまま
  it('同じターンを二度公開してもURLは増えない', async () => {
    const first  = await useSharedTurn().share('a-1', 'q-1')
    const second = await useSharedTurn().share('a-1', 'q-1')

    expect(first).toBe('live-token')
    expect(second).toBe('live-token')
    expect(db.shared_messages).toHaveLength(1)
  })

  // 閲覧者が最初に見る文字列。会話IDもメッセージIDも出さない
  it('共有URLにはトークンだけが出る', () => {
    expect(shareUrl('live-token')).toBe(`${window.location.origin}/s/live-token`)
    expect(shareUrl('live-token')).not.toContain('a-1')
  })
})
