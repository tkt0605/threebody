import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { useChat } from '../useChat'
import { useAuth } from '../useAuth'
import { useConversationBrief } from '../useConversationBrief'

const db = vi.hoisted(() => ({
  loads: new Map<string, Promise<{ data: unknown[]; error: null }>>(),
  create: vi.fn(),
  inserts: vi.fn(),
}))
vi.mock('../useAuth', async () => {
  const { ref } = await import('vue')
  const user = ref(null)
  return { useAuth: () => ({ user }) }
})
vi.mock('../useCapabilities', () => ({ useCapabilities: () => ({ refreshCapabilities: vi.fn() }) }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (table: string) => {
      let filterId = ''
      let insertedId = ''
      const result = { data: [], error: null }
      const query = {
        select: () => query,
        eq: (_key: string, value: string) => { filterId = value; return query },
        insert: (row: { id?: string }) => { db.inserts(table, row); insertedId = row.id ?? ''; return query },
        upsert: () => query,
        update: () => query,
        delete: () => query,
        in: () => query,
        order: () => table === 'messages' ? (db.loads.get(filterId) ?? Promise.resolve(result)) : Promise.resolve(result),
        single: () => table === 'conversations' ? db.create() : Promise.resolve({ data: { id: insertedId }, error: null }),
        then: Promise.resolve(result).then.bind(Promise.resolve(result)),
      }
      return query
    },
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

function rows(id: string) {
  return { data: [{ id, role: 'user', timestamp: '2026-09-06T00:00:00Z', content_blocks: [] }], error: null }
}

beforeEach(() => {
  db.loads.clear()
  db.inserts.mockClear()
  db.create.mockReset().mockResolvedValue({ data: { id: 'created' }, error: null })
  useAuth().user.value = null
  useAuth().user.value = { id: 'test-user' } as User
  useChat().startNewConversation()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  useAuth().user.value = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('会話とノートの非同期ライフサイクル', () => {
  it('会話の履歴を読み込む間は送信せず、完了すると送信可能になる', async () => {
    const pending = deferred<ReturnType<typeof rows>>()
    db.loads.set('first', pending.promise)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const chat = useChat()
    const opening = chat.openConversation('first')
    expect(chat.loadingConversation.value).toBe(true)
    await chat.sendMessage('履歴がまだない間の送信')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(chat.messages.value).toEqual([])
    pending.resolve(rows('loaded'))
    await opening
    expect(chat.loadingConversation.value).toBe(false)
    expect(chat.messages.value[0]?.id).toBe('loaded')
  })
  it('先に選んだ会話の読み込みが遅れても、最後に選んだ会話とノートを保つ', async () => {
    const first = deferred<ReturnType<typeof rows>>()
    db.loads.set('first', first.promise)
    db.loads.set('second', Promise.resolve(rows('second-message')))
    const chat = useChat()
    const opening = chat.openConversation('first')
    await chat.openConversation('second')
    useConversationBrief().brief.value.purpose = '二つ目の目的'
    first.resolve(rows('first-message'))
    await opening
    expect(chat.currentConversationId.value).toBe('second')
    expect(chat.messages.value[0]?.id).toBe('second-message')
    expect(useConversationBrief().brief.value.purpose).toBe('二つ目の目的')
  })

  it('ログアウト後に以前の会話の読み込みが完了しても表示しない', async () => {
    const pending = deferred<ReturnType<typeof rows>>()
    db.loads.set('first', pending.promise)
    const chat = useChat()
    const opening = chat.openConversation('first')
    useAuth().user.value = null
    pending.resolve(rows('private-message'))
    await opening
    expect(chat.messages.value).toEqual([])
    expect(chat.currentConversationId.value).toBeNull()
  })

  it('新規作成の保存待ちで会話を変えても、切り替え先のノートを古いIDに結び付けない', async () => {
    const created = deferred<{ data: { id: string }; error: null }>()
    db.create.mockReturnValue(created.promise)
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort)
    })))
    const chat = useChat()
    const sending = chat.sendMessage('元の相談')
    await vi.waitFor(() => expect(db.create).toHaveBeenCalledOnce())
    await chat.openConversation('other')
    useConversationBrief().brief.value.purpose = '別の目的'
    created.resolve({ data: { id: 'old-created' }, error: null })
    await sending
    await vi.waitFor(() => expect(chat.aiState.value).toBe('idle'))
    expect(chat.currentConversationId.value).toBe('other')
    expect(useConversationBrief().brief.value.purpose).toBe('別の目的')
    await chat.openConversation('old-created')
    expect(useConversationBrief().brief.value.purpose).toBe('')
  })

  it('最初の質問と即時応答の保存が重なっても会話を一つだけ作り、ノートを保持する', async () => {
    const created = deferred<{ data: { id: string }; error: null }>()
    db.create.mockReturnValue(created.promise)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"text","content":"回答"}\n\ndata: [DONE]\n\n'))
        controller.close()
      },
    }))))
    const chat = useChat()
    useConversationBrief().brief.value.purpose = '保持する目的'
    const sending = chat.sendMessage('相談')
    await vi.waitFor(() => expect(chat.messages.value.at(-1)?.blocks[0]).toMatchObject({ content: '回答' }))
    created.resolve({ data: { id: 'created' }, error: null })
    await sending
    expect(db.create).toHaveBeenCalledOnce()
    expect(chat.currentConversationId.value).toBe('created')
    await vi.waitFor(() => expect(db.inserts.mock.calls.filter(([table]) => table === 'messages')).toHaveLength(2))
    chat.startNewConversation()
    await chat.openConversation('created')
    expect(useConversationBrief().brief.value.purpose).toBe('保持する目的')
    const writes = db.inserts.mock.calls.filter(([table]) => table === 'messages')
    expect(writes).toHaveLength(2)
    expect(writes.every(([, row]) => row.conversation_id === 'created')).toBe(true)
  })
})
