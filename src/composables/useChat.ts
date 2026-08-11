import { ref, computed, watch } from 'vue'
import type { Message, TextBlock, PerspectiveBlock } from '../types/message'
import { useSettings, type BodyProvider, isBodyUsable } from './useSettings'
import { buildSystemPrompt, buildBodyPersonaPrompt } from './useSystemPrompt'
import { BODY_PERSONA_INFO } from '../constants/bodyPersonas'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useCapabilities } from './useCapabilities'
import { redactText } from '../lib/redact'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000'

// 現在アプリが保持している秘匿値。BodyConfig.apiKey は復号済みの平文なのでここで集める
function currentSecrets(): string[]{
  const { settings } = useSettings()
  return settings.bodies.map(b => b.apiKey)
}

// 加工前の生メッセージ。原因追跡に必要だが、秘匿値は必ず落としてから返す
export function rawErrorMessage(err: unknown): string{
  const raw = err instanceof Error ? err.message : String(err)
  return redactText(raw, currentSecrets())
}

// バックエンドが「バグではなく仕様どおりの状態」として送るエラー（例: 共有キーの日次上限到達）に
// 付くコード。この種のエラーは reportError の対象にしない（ユーザーに「異常」と誤解させないため）
class ChatStreamError extends Error {
  code?: string | undefined
  constructor(message?: string | undefined, code?: string | undefined){
    super(message)
    this.code = code
  }
}

function classifyError(err: unknown): string{
  return redactText(classifyErrorMessage(err), currentSecrets())
}

function classifyErrorMessage(err: unknown): string{
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')){
    return 'ネットワークに接続できません。バックエンドが起動しているか確認してください。'
  }
  if (err instanceof Error){
        if (err.message.startsWith('HTTP 429')) return 'APIの利用制限に達しました。しばらく経ってから再試行してください。'
    if (err.message.startsWith('HTTP 5'))   return `サーバーエラーが発生しました (${err.message})。`
    if (err.message.startsWith('HTTP '))    return `リクエストが失敗しました (${err.message})。`
    return err.message
  }
  return String(err)
}
// バックエンドに「誰からのリクエストか」を伝えるヘッダ。共有APIキーの割当判定に使う。
// 未ログインなら何も付けず、サーバー側は従来どおり（ユーザー自身のキーで）処理する
async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const messages = ref<Message[]>([])
const aiState = ref<'idle' | 'thinking' | 'synthesizing' | 'converging'>('idle');

export interface PendingBody { bodyIndex: number; name: string; provider: BodyProvider }
// 三体モードで現在応答待ちの副体一覧（body_start〜body_doneの間だけ存在）
const pendingBodies = ref<PendingBody[]>([])

export interface Conversation { id: string; title: string | null; createdAt: Date; updatedAt: Date }
// ユーザーの全会話一覧（updated_at降順）。サイドバーの会話切り替えに使う
const conversations = ref<Conversation[]>([])
// 現在チャット画面に表示中の会話
const currentConversationId = ref<string | null>(null)
const currentConversation = computed(() =>
  conversations.value.find(c => c.id === currentConversationId.value) ?? null
)

// ログアウト後に別アカウントでログインした場合、前ユーザーの会話/履歴を引き継がないようにする
watch(useAuth().user, (newUser, oldUser) => {
  if (newUser?.id !== oldUser?.id) {
    currentConversationId.value = null
    conversations.value = []
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

// conversations.user_id は user_setting.id への外部キーのため、先にプロフィール行を用意しておく必要がある
async function ensureUserProfile(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_setting')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, timestamp, content_blocks(type, payload, sort_order)')
    .eq('conversation_id', conversationId)
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

// サイドバーに表示する会話一覧を読み込む（最終更新が新しい順）
async function loadConversations(): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.value.id)
    .order('updated_at', { ascending: false })
  if (error) { console.error(error); return }

  conversations.value = (data ?? []).map(row => ({
    id:        row.id as string,
    title:     row.title as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }))
}

// 新規会話を作成し、現在表示中の会話として切り替える
async function createConversation(): Promise<string> {
  const { user } = useAuth()
  if (!user.value) throw new Error('ログインしていません')

  await ensureUserProfile(user.value.id)

  const now = new Date()
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ user_id: user.value.id, created_at: now.toISOString(), updated_at: now.toISOString() })
    .select('id')
    .single()
  if (error) throw error

  const id = created.id as string
  conversations.value = [{ id, title: null, createdAt: now, updatedAt: now }, ...conversations.value]
  currentConversationId.value = id
  // messages.value はここでは触らない。送信フロー（ensureConversation経由）の途中でここが呼ばれる場合、
  // 既にsendMessageがpush済みのuser/assistantメッセージを消してしまうため。
  // 画面をまっさらにする役目は呼び出し元のstartNewConversation()が既に担っている
  return id
}

// 指定した会話に切り替え、その履歴を読み込む（読み取り専用ではなく、そのまま続きから会話できる）
// 進行中のストリーミングを中断するためのコントローラ。
// 会話の切り替えや次の送信で、前のストリームを確実に止められるようにする。
// 止められないと (1) 破棄したはずのmessageへ書き込みが続く (2) Lv5は最大32Kトークンを
// 生成し切ってしまう (3) 共有キー利用時はその1回分のクォータが戻らない、の3つが起きる
let inFlight: AbortController | null = null

// 進行中の応答があれば中断する。無ければ何もしない。
// UIの状態もここで戻す。中断されたリクエスト自身のfinallyに任せると、
// 「新しい送信が始まった直後に古い方のfinallyがidleへ戻す」競合が起きる
function stopGeneration(): void {
  if (!inFlight) return
  inFlight.abort()
  inFlight = null
  aiState.value = 'idle'
  pendingBodies.value = []
}

async function switchConversation(id: string): Promise<void> {
  // 切り替え前に止める。止めないと、前の会話のストリームが
  // 新しい会話の画面へ書き込みを続ける
  stopGeneration()
  currentConversationId.value = id
  messages.value = await fetchMessages(id)
}

// 「新規会話」ボタン用のフラグ。trueの間は、次にensureConversationが呼ばれても
// 既存の会話を再利用せず、新しい会話を作る（＝最初のメッセージが送られるまでDBには何も書き込まない）
let pendingNewConversation = false

// 画面をまっさらな状態に戻すだけで、conversationsテーブルへの書き込みは行わない。
// 実際に会話が作られるのは、ここから最初のメッセージが送信されたタイミング（persistMessage経由）
function startNewConversation(): void {
  stopGeneration()
  currentConversationId.value = null
  messages.value = []
  pendingNewConversation = true
}

// 現在の会話が無ければ、最終更新が最も新しい会話（無ければ新規作成した会話）を現在の会話にする
async function ensureConversation(userId: string): Promise<string> {
  if (currentConversationId.value) return currentConversationId.value

  await ensureUserProfile(userId)

  if (pendingNewConversation) {
    pendingNewConversation = false
    return createConversation()
  }

  if (conversations.value.length > 0) {
    currentConversationId.value = conversations.value[0]!.id
    return currentConversationId.value
  }

  return createConversation()
}

// 会話のタイトルを変更する（空文字なら未設定=nullに戻す）
async function renameConversation(id: string, title: string): Promise<void> {
  const trimmed = title.trim() || null
  const { error } = await supabase.from('conversations').update({ title: trimmed }).eq('id', id)
  if (error) { console.error('タイトルの更新に失敗しました', error); return }

  const conv = conversations.value.find(c => c.id === id)
  if (conv) conv.title = trimmed
}

// 会話とその中身（messages/content_blocks）をまとめて削除する
async function deleteConversation(id: string): Promise<void> {
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (currentConversationId.value === id) {
    currentConversationId.value = null
    messages.value = []
  }

  try {
    const { data: msgRows, error: selErr } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', id)
    if (selErr) throw selErr

    const ids = (msgRows ?? []).map(r => r.id as string)
    if (ids.length > 0) {
      const { error: cbErr } = await supabase.from('content_blocks').delete().in('message_id', ids)
      if (cbErr) throw cbErr
    }

    const { error: msgErr } = await supabase.from('messages').delete().eq('conversation_id', id)
    if (msgErr) throw msgErr

    const { error: convErr } = await supabase.from('conversations').delete().eq('id', id)
    if (convErr) throw convErr
  } catch (err) {
    console.error('会話の削除に失敗しました', err)
  }
}

// URLの /c/:id からの遷移・ページ再読み込み時に呼ぶ。idを渡せばその会話に切り替え、
// 渡さなければ最後に開いていた（無ければ新規作成した）会話を開く。開いた会話のidを返す
async function openConversation(id?: string): Promise<string | null> {
  const { user } = useAuth()
  if (!user.value) return null

  await loadConversations()

  if (id) {
    pendingNewConversation = false
    if (id !== currentConversationId.value) await switchConversation(id)
    return id
  }

  // 上のawait中に、別経路（sendMessage→persistMessage→ensureConversation）で
  // 既に会話が確定していることがある。その場合は作った本人に任せ、ここではmessagesに触れない
  if (currentConversationId.value) return currentConversationId.value

  // 「新規会話」直後はDBにまだ何も無いので、ここでは何も作らない。
  // すでにstartNewConversation()でmessages/currentConversationIdは空にしてあるので、
  // ここで触ると「待っている間に最初のメッセージが送信済み」だった場合に消してしまうため何もしない
  if (pendingNewConversation) {
    return null
  }

  try {
    const convId = await ensureConversation(user.value.id)
    messages.value = await fetchMessages(convId)
    return convId
  } catch (err) {
    console.error('会話の取得に失敗しました', err)
    return null
  }
}

// エラーブロックは一時的な表示のみ。DBのblock_type enumに'error'が無いため永続化しない
async function persistMessage(message: Message): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  const textBlocks = message.blocks.filter((b): b is TextBlock => b.type === 'text')
  if (textBlocks.length === 0) return

  const convId = await ensureConversation(user.value.id)

  const { data: inserted, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convId,
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

  // 会話一覧を最終更新順に保つため、conversations.updated_at も更新する
  const updatedAt = new Date()
  await supabase.from('conversations').update({ updated_at: updatedAt.toISOString() }).eq('id', convId)
  const conv = conversations.value.find(c => c.id === convId)
  if (conv) conv.updatedAt = updatedAt
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
  const { refreshCapabilities } = useCapabilities()

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

    // 前の応答がまだ流れていれば止めてから始める（多重ストリームを作らない）
    stopGeneration()
    const controller = new AbortController()
    inFlight = controller
    let aborted = false

    try {
      aiState.value = 'thinking';
      pendingBodies.value = []
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
              code?: string
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
            if (parsed.type === 'error') throw new ChatStreamError(parsed.message, parsed.code)
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
    } catch (err) {
      if (!block.content) reactiveMsg.blocks.splice(reactiveMsg.blocks.indexOf(block), 1)

      // 中断はユーザー起因（会話切替・新規会話・次の送信）なのでエラーではない。
      // ここで抜けることで、エラーブロックの表示と、切り替え先の会話への
      // 誤った永続化（下のfinally）の両方を避ける
      if (err instanceof DOMException && err.name === 'AbortError') {
        aborted = true
        return
      }

      const display = classifyError(err)      // 伏字化済み
      const raw     = rawErrorMessage(err)    // 伏字化済み
      // 上限到達（個人枠・全体枠とも）はバグではなく仕様どおりの状態なので、context を付けない
      // （MessageBubble.vue は context の有無で「問題を報告する」ボタンを出し分ける）
      const isExpected = err instanceof ChatStreamError
        && (err.code === 'limit_reached' || err.code === 'global_limit_reached')

      reactiveMsg.blocks.push({
          type: 'error',
          message: display,
          ...(isExpected ? {} : { context: {
            raw,
            display,
            thinkingLevel: settings.thinkingLevel,
            // b ではなく b.provider。ここで b と書くと apiKey ごと持っていく
            providers: settings.bodies.filter(isBodyUsable).map(b => b.provider),
            conversationId: currentConversationId.value,
            userAgent: navigator.userAgent,
            occurredAt: new Date().toISOString(),
         }}),
      })
    } finally {
      reactiveMsg.streaming = false  // Proxy 経由で書くことで watch を発火させる

      // 自分がまだ「現在進行中」の場合だけ共有状態を戻す。
      // 中断済みの場合は stopGeneration が既に戻しているか、
      // 後続の送信が thinking にしているので触ってはいけない
      if (inFlight === controller) {
        inFlight = null
        aiState.value = 'idle'
        pendingBodies.value = []
      }

      // 中断時は保存しない。ensureConversation は「現在の会話」を返すため、
      // 会話切替による中断だと切り替え先へ書き込んでしまう
      if (!aborted) {
        persistMessage(reactiveMsg).catch(err => console.error('メッセージの保存に失敗しました', err))
        // 共有キーを使った場合、残り回数がここで変わる。UIの表示を最新に保つ
        void refreshCapabilities()
      }
    }
  }

  // 応答が欠けたまま宙ぶらりんになったユーザーメッセージを、削除した上で送り直す
  async function retryMessage(message: Message): Promise<void> {
    const text = flattenText(message.blocks)
    await deleteMessage(message.id)
    if (text.trim()) await sendMessage(text)
  }

  return {
    messages, sendMessage, stopGeneration, aiState, pendingBodies, openConversation, deleteMessage, retryMessage,
    conversations, currentConversationId, currentConversation,
    startNewConversation, deleteConversation, renameConversation,
  }
}
