import { ref, watch } from 'vue'
import type { Message, TextBlock, PerspectiveBlock } from '../types/message'
import { useSettings, type BodyProvider } from './useSettings'
import { buildSystemPrompt } from './useSystemPrompt'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const API_BASE = import.meta.env.VITE_API_BASE_URL as string

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

async function ensureSession(userId: string): Promise<string> {
  if (sessionId) return sessionId

  await ensureUserProfile(userId)

  const { data: existing, error: selectErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selectErr) throw selectErr

  if (existing) {
    sessionId = existing.id as string
    return sessionId
  }

  const { data: created, error: insertErr } = await supabase
    .from('sessions')
    .insert({ user_id: userId, started_at: new Date().toISOString() })
    .select('id')
    .single()
  if (insertErr) throw insertErr

  sessionId = created.id as string
  return sessionId
}

// 会話履歴をDBから読み込み、ページ再読み込み後も続きから会話できるようにする
async function loadHistory(): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

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

  messages.value = (data ?? []).map((row): Message => ({
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
          bodies: settings.bodies,
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

  return { messages, sendMessage, aiState, pendingBodies, loadHistory, deleteMessage, retryMessage }
}
