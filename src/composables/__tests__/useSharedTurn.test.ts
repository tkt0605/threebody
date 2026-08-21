import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PerspectiveBlock, TextBlock } from '../../types/message'

// 【このテストが押さえているもの】
// 共有していないメッセージへ、公開側のコードから到達できないこと。
//
// RLS そのものは Postgres の中にあるのでここでは動かない。代わりに、
//   1. クライアント側 — URLの文字列が messages の絞り込みに渡る経路が1つも無いこと
//   2. サーバー側 — 台帳（shared_messages）に生きた行が無いメッセージは見えないこと
// の2つを、下の偽 supabase が RLS と同じ条件を再現して確かめる。
// 本物のポリシーの検証は scripts/verify-share-rls.mjs（実プロジェクトへ接続する）。

type Row = Record<string, unknown>

const db = {
  shared_messages: [] as Row[],
  messages:        [] as Row[],
}

// messages に対して実際に発行された絞り込み。URLの文字列がそのまま渡っていないことを見る
const messageFilters: Row[] = []

// 生きている共有から辿れる message_id（＝ anon に見える行）。
// docs/schema.sql の messages_select_shared / content_blocks_select_shared と同じ条件
function visibleMessageIds(): string[] {
  return db.shared_messages
    .filter(r => r.revoked_at == null)
    .flatMap(r => [r.message_id as string, r.question_message_id as string | null])
    .filter((id): id is string => id != null)
}

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
    // select。anon から見える範囲まで絞ってから、クエリの条件を当てる
    let source = db[table as keyof typeof db]
    if (table === 'messages') {
      messageFilters.push({ ...filters })
      const visible = visibleMessageIds()
      source = source.filter(r => visible.includes(r.id as string))
    }
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
    select: () => api,
    insert: (row: Row) => { mode = 'insert'; payload = row; return api },
    update: (row: Row) => { mode = 'update'; payload = row; return api },
    eq: (col: string, val: unknown) => { filters[col] = val; return api },
    is: (col: string, val: unknown) => { filters[col] = val; return api },
    in: (col: string, vals: unknown[]) => { filters[`${col}__in`] = vals; return api },
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
    { id: 'q-1', role: 'user',      content: '共有したターンの問い', content_blocks: [] },
    { id: 'a-1', role: 'assistant', content: '答えの本文',           content_blocks: ANSWER_BLOCKS },
    { id: 'q-2', role: 'user',      content: '共有していないターンの問い', content_blocks: [] },
    { id: 'a-2', role: 'assistant', content: '共有していない答え',   content_blocks: [] },
  ]
  db.shared_messages = [
    { token: 'live-token', message_id: 'a-1', question_message_id: 'q-1', user_id: 'user-1', created_at: '2026-08-21T00:00:00Z', revoked_at: null },
  ]
}

describe('useSharedTurn', () => {
  beforeEach(() => {
    seed()
    messageFilters.length = 0
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

    // 台帳に無いトークンで止まるので、messages へは1度も問い合わせない
    expect(messageFilters).toHaveLength(0)
  })

  it('取り消した共有は読めなくなる', async () => {
    await useSharedTurn().share('a-1', 'q-1')  // 既存のトークンを拾う
    expect(await useSharedTurn().revoke('a-1')).toBe(true)

    expect(await useSharedTurn().fetchByToken('live-token')).toBeNull()
    // 行は消さずに revoked_at を立てる（共有していた事実を残す）
    expect(db.shared_messages).toHaveLength(1)
    expect(db.shared_messages[0]!.revoked_at).not.toBeNull()
  })

  it('messages を引くのは、台帳から得たIDだけ', async () => {
    await useSharedTurn().fetchByToken('live-token')

    expect(messageFilters).toEqual([{ id__in: ['a-1', 'q-1'] }])
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
