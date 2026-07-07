import { ref, watch } from 'vue'
import type { Message, TextBlock, PerspectiveBlock } from '../types/message'
import { useSettings, type BodyProvider } from './useSettings'
import { buildSystemPrompt, buildBodyPersonaPrompt } from './useSystemPrompt'
import { BODY_PERSONA_INFO } from '../constants/bodyPersonas'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000'

function classifyError(err: unknown): string {
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return 'ネットワークに接続できません。バックエンドが起動しているか確認してください。'
  }
  if (err instanceof Error) {
    if (err.message.startsWith('HTTP 429')) return 'APIの利用制限に達しました。しばらく経ってから再試行してください。'
    if (err.message.startsWith('HTTP 5'))   return `サーバーエラーが発生しました (${err.message})。`
    if (err.message.startsWith('HTTP '))    return `リクエストが失敗しました (${err.message})。`
    return err.message
  }
  return String(err)
}

const messages = ref<Message[]>([])
const aiState = ref<'idle' | 'thinking' | 'synthesizing' | 'converging'>('idle');

export interface PendingBody { bodyIndex: number; name: string; provider: BodyProvider }
// 三体モードで現在応答待ちの副体一覧（body_start〜body_doneの間だけ存在）
const pendingBodies = ref<PendingBody[]>([])

// 1ユーザー1セッションを継続する前提（会話切り替えUIがまだ無いため）
let sessionId: string | null = null
// ヘッダーのタイトル表示用（現在のセッションがいつ始まったか）
const currentSessionStartedAt = ref<Date | null>(null)

export interface ArchivedSession { id: string; startedAt: Date; endedAt: Date }
const archivedSessions = ref<ArchivedSession[]>([])

// ログアウト後に別アカウントでログインした場合、前ユーザーのセッション/履歴を引き継がないようにする
watch(useAuth().user, (newUser, oldUser) => {
  if (newUser?.id !== oldUser?.id) {
    sessionId = null
    messages.value = []
  }
})

function createId() {
  return crypto.randomUUID()
}

function flattenText(blocks: Message['blocks']) {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.content)
    .join('')
}

function toApiMessages(msgs: Message[]) {
  return msgs.map(m => ({
    role: m.role,
    content: flattenText(m.blocks),
  }))
}

// sessions.user_id は user_setting.id への外部キーのため、先にプロフィール行を用意しておく必要がある
async function ensureUserProfile(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_setting')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

// 最後のメッセージからこの時間以上経っていたら、画面は空から始める（裏の履歴は残す）
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000

async function ensureSession(userId: string): Promise<string> {
  if (sessionId) return sessionId

  await ensureUserProfile(userId)

  // ended_at が付いた（＝期限切れで区切られた）セッションは再利用しない
  const { data: existing, error: selectErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selectErr) throw selectErr

  if (existing) {
    sessionId = existing.id as string
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('started_at')
      .eq('id', sessionId)
      .single()
    currentSessionStartedAt.value = sessionRow ? new Date(sessionRow.started_at as string) : new Date()
    return sessionId
  }

  const startedAt = new Date()
  const { data: created, error: insertErr } = await supabase
    .from('sessions')
    .insert({ user_id: userId, started_at: startedAt.toISOString() })
    .select('id')
    .single()
  if (insertErr) throw insertErr

  sessionId = created.id as string
  currentSessionStartedAt.value = startedAt
  return sessionId
}

// 現在のセッションを終了させ（裏に残す）、画面は空の新しいセッションから始める
async function archiveCurrentSession(): Promise<void> {
  const { user } = useAuth()
  if (!user.value || !sessionId) return

  try {
    const { error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId)
    if (error) throw error
  } catch (err) {
    console.error('アーカイブに失敗しました', err)
    return
  }

  sessionId = null
  messages.value = []
  await ensureSession(user.value.id)
  await loadArchivedSessions()
}

// サイドバーに表示する、アーカイブ済み（終了済み）セッションの一覧を読み込む
async function loadArchivedSessions(): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at, ended_at')
    .eq('user_id', user.value.id)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })
  if (error) { console.error(error); return }

  archivedSessions.value = (data ?? []).map(row => ({
    id:       row.id as string,
    startedAt: new Date(row.started_at as string),
    endedAt:   new Date(row.ended_at as string),
  }))
}

// アーカイブされたセッションを、中身（content_blocks/messages）ごと完全に削除する
async function deleteArchive(sessionId: string): Promise<void> {
  archivedSessions.value = archivedSessions.value.filter(s => s.id !== sessionId)
  try {
    const { data: msgRows, error: selErr } = await supabase
      .from('messages')
      .select('id')
      .eq('session_id', sessionId)
    if (selErr) throw selErr

    const ids = (msgRows ?? []).map(r => r.id as string)
    if (ids.length > 0) {
      const { error: cbErr } = await supabase.from('content_blocks').delete().in('message_id', ids)
      if (cbErr) throw cbErr
    }

    const { error: msgErr } = await supabase.from('messages').delete().eq('session_id', sessionId)
    if (msgErr) throw msgErr

    const { error: sessErr } = await supabase.from('sessions').delete().eq('id', sessionId)
    if (sessErr) throw sessErr
  } catch (err) {
    console.error('アーカイブの削除に失敗しました', err)
  }
}

// アーカイブされたセッションの中身を読み取り専用で取得する（現在の会話状態には影響しない）
async function loadArchivedMessages(sessionId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, timestamp, content_blocks(type, payload, sort_order)')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true })
  if (error) { console.error(error); return [] }

  return (data ?? []).map((row): Message => ({
    id: row.id as string,
    role: row.role as Message['role'],
    timestamp: new Date(row.timestamp as string),
    blocks: (row.content_blocks as { type: string; payload: { content: string }; sort_order: number }[])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((b) => ({ type: 'text', content: b.payload.content })),
  }))
}

// 会話履歴をDBから読み込み、ページ再読み込み後も続きから会話できるようにする
async function loadHistory(): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  loadArchivedSessions()

  let sid: string
  try {
    sid = await ensureSession(user.value.id)
  } catch (err) {
    console.error('セッションの取得に失敗しました', err)
    return
  }

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, timestamp, content_blocks(type, payload, sort_order)')
    .eq('session_id', sid)
    .order('timestamp', { ascending: true })
  if (error) { console.error(error); return }

  const rows = data ?? []
  const lastRow = rows[rows.length - 1]
  const idleTooLong = lastRow != null && Date.now() - new Date(lastRow.timestamp as string).getTime() > SESSION_IDLE_MS

  if (idleTooLong) {
    try {
      const { error: endErr } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', sid)
      if (endErr) throw endErr
      sessionId = null
      await ensureSession(user.value.id)
      loadArchivedSessions()
    } catch (err) {
      console.error('セッションの切り替えに失敗しました', err)
    }
    messages.value = []
    return
  }

  messages.value = rows.map((row): Message => ({
    id: row.id as string,
    role: row.role as Message['role'],
    timestamp: new Date(row.timestamp as string),
    blocks: (row.content_blocks as { type: string; payload: { content: string }; sort_order: number }[])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((b) => ({ type: 'text', content: b.payload.content })),
  }))
}

// エラーブロックは一時的な表示のみ。DBのblock_type enumに'error'が無いため永続化しない
async function persistMessage(message: Message): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  const textBlocks = message.blocks.filter((b): b is TextBlock => b.type === 'text')
  if (textBlocks.length === 0) return

  const sid = await ensureSession(user.value.id)

  const { data: inserted, error: msgErr } = await supabase
    .from('messages')
    .insert({
      session_id: sid,
      role:       message.role,
      content:    flattenText(message.blocks),
      timestamp:  message.timestamp.toISOString(),
    })
    .select('id')
    .single()
  if (msgErr) throw msgErr

  const blockRows = textBlocks.map((b, i) => ({
    message_id: inserted.id as string,
    type:       'text' as const,
    payload:    { content: b.content },
    sort_order: i,
  }))

  const { error: blocksErr } = await supabase.from('content_blocks').insert(blockRows)
  if (blocksErr) throw blocksErr
}

// AIの返答が保存される前に中断された等で、応答が欠けたまま宙ぶらりんになったメッセージを削除する
async function deleteMessage(id: string): Promise<void> {
  messages.value = messages.value.filter(m => m.id !== id)
  try {
    await supabase.from('content_blocks').delete().eq('message_id', id)
    await supabase.from('messages').delete().eq('id', id)
  } catch (err) {
    console.error('メッセージの削除に失敗しました', err)
  }
}

export function useChat() {
  const { settings } = useSettings()

  async function sendMessage(text: string) {
    const userMsg: Message = {
      id: createId(),
      role: 'user',
      blocks: [{ type: 'text', content: text }],
      timestamp: new Date(),
    }
    messages.value.push(userMsg)
    persistMessage(userMsg).catch(err => console.error('メッセージの保存に失敗しました', err))

    messages.value.push({
      id: createId(),
      role: 'assistant',
      blocks: [{ type: 'text', content: '' }],
      timestamp: new Date(),
      streaming: true,
    })

    // push後にリアクティブ配列経由で参照することで Vue の Proxy を通す
    const reactiveMsg = messages.value[messages.value.length - 1]!
    const block = reactiveMsg.blocks[0] as TextBlock

    try {
      aiState.value = 'thinking';
      pendingBodies.value = []
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(messages.value.slice(0, -1)),
          thinkingLevel: settings.thinkingLevel,
          systemPrompt: buildSystemPrompt(settings),
          provider: settings.provider,
          bodies: settings.bodies.map(b => ({
            provider: b.provider,
            apiKey: b.apiKey,
            model: b.model,
            name: BODY_PERSONA_INFO[b.role].name,
            personaPrompt: buildBodyPersonaPrompt(settings, b.role),
          })),
          model:  settings.bodies.find(b => b.provider === settings.provider)?.model,
          apiKey: settings.bodies.find(b => b.provider === settings.provider)?.apiKey,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break outer
          try {
            const parsed = JSON.parse(data) as {
              type: string
              content?: string
              message?: string
              bodyIndex?: number
              name?: string
              provider?: string
            }
            if (parsed.type === 'body_start' && parsed.bodyIndex != null) {
              pendingBodies.value.push({ bodyIndex: parsed.bodyIndex, name: parsed.name ?? '副体', provider: (parsed.provider ?? 'ollama') as BodyProvider })

              let perspectiveBlock = reactiveMsg.blocks.find((b): b is PerspectiveBlock => b.type === 'perspective')
              if (!perspectiveBlock) {
                perspectiveBlock = { type: 'perspective', bodies: [] }
                reactiveMsg.blocks.unshift(perspectiveBlock)
              }
              perspectiveBlock.bodies.push({
                bodyIndex: parsed.bodyIndex,
                name:      parsed.name ?? '副体',
                provider:  parsed.provider ?? 'ollama',
                content:   '',
                done:      false,
              })
            }
            if (parsed.type === 'body_text' && parsed.bodyIndex != null && parsed.content) {
              const perspectiveBlock = reactiveMsg.blocks.find((b): b is PerspectiveBlock => b.type === 'perspective')
              const entry = perspectiveBlock?.bodies.find(b => b.bodyIndex === parsed.bodyIndex)
              if (entry) entry.content += parsed.content
            }
            if (parsed.type === 'body_done' && parsed.bodyIndex != null) {
              pendingBodies.value = pendingBodies.value.filter(b => b.bodyIndex !== parsed.bodyIndex)

              const perspectiveBlock = reactiveMsg.blocks.find((b): b is PerspectiveBlock => b.type === 'perspective')
              const entry = perspectiveBlock?.bodies.find(b => b.bodyIndex === parsed.bodyIndex)
              if (entry) entry.done = true
            }
            if (parsed.type === 'synthesis_start') {
              pendingBodies.value = []
              aiState.value = 'synthesizing'
              if (parsed.bodyIndex != null) block.bodyIndex = parsed.bodyIndex
            }
            if (parsed.type === 'text' && parsed.content){
              block.content += parsed.content
              if (aiState.value !== 'converging') aiState.value = 'converging'
            }
            if (parsed.type === 'error') throw new Error(parsed.message)
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
    } catch (err) {
      if (!block.content) reactiveMsg.blocks.splice(reactiveMsg.blocks.indexOf(block), 1)
      reactiveMsg.blocks.push({ type: 'error', message: classifyError(err) })
    } finally {
      reactiveMsg.streaming = false  // Proxy 経由で書くことで watch を発火させる
      aiState.value = 'idle';
      pendingBodies.value = []
      persistMessage(reactiveMsg).catch(err => console.error('メッセージの保存に失敗しました', err))
    }
  }

  // 応答が欠けたまま宙ぶらりんになったユーザーメッセージを、削除した上で送り直す
  async function retryMessage(message: Message): Promise<void> {
    const text = flattenText(message.blocks)
    await deleteMessage(message.id)
    if (text.trim()) await sendMessage(text)
  }

  return {
    messages, sendMessage, aiState, pendingBodies, loadHistory, deleteMessage, retryMessage,
    currentSessionStartedAt, archiveCurrentSession, archivedSessions, loadArchivedMessages, deleteArchive,
  }
}
