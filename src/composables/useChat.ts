import { ref, computed, watch } from 'vue'
import type { Message, TextBlock, PerspectiveBlock, ContentBlock, BodyPerspective } from '../types/message'
import { hasSignal, NO_SIGNALS, type TurnSignals } from '../types/intent'
import { useSettings, type BodyProvider, isBodyUsable } from './useSettings'
import { buildSystemPrompt } from './useSystemPrompt'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useCapabilities } from './useCapabilities'
import { redactText } from '../lib/redact'
import type { Modality } from '../types/intent'

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
  constructor(message?: string, code?: string){
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
    // /api/chat は認証必須。画面はログイン済みでも、セッションの期限切れで
    // ここに来ることがある。「リクエストが失敗しました (HTTP 401)」では
    // 何をすればいいか分からないので、再ログインを促す
    if (err.message.startsWith('HTTP 401')) return 'ログインの有効期限が切れました。再度ログインしてください。'
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
export type AiState = 'idle' | 'thinking' | 'synthesizing' | 'converging'
const aiState = ref<AiState>('idle');

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

// バックエンドへ送る履歴の最大件数（user/assistant を合わせた通数）。
// 10 ≒ 直近5往復。
//
// 【なぜ切るか】これまで会話の全メッセージを毎回送っており、入力トークンが会話の
// 長さに比例して増え続けていた。しかも三体モードでは同じ履歴を副体2つ＋主体に
// 送るため、その増分がそのまま3倍になる。1ターン $0.00998 の実測でも
// 「出力ではなく入力の3倍化が支配的」と分かっており、ここが主なレバーになる。
//
// 【副作用】これより古い発言は参照できなくなる。長い会話で「さっき言ったこと」を
// 忘れる挙動になるため、体感を見て調整すること
export const HISTORY_LIMIT = 10

// 直近 HISTORY_LIMIT 件だけをバックエンドへ送る。
// 先頭ではなく末尾から取るのは、直近の文脈のほうが応答に効くため。
//
// 本文が空のターンは落とす。中断された応答は本文を持たないことがあり、そのまま送ると
// 「何も言わなかったアシスタント」が履歴に並んで文脈を汚す（プロバイダーによっては
// 空の content 自体を弾く）。切り詰めの前に落とすことで、空ターンが HISTORY_LIMIT の
// 枠を食って本当に必要な往復を押し出すのも防ぐ
function toApiMessages(msgs: Message[]) {
  return msgs
    .map(m => ({ role: m.role, content: flattenText(m.blocks) }))
    .filter(m => m.content !== '')
    .slice(-HISTORY_LIMIT)
}

// conversations.user_id は user_setting.id への外部キーのため、先にプロフィール行を用意しておく必要がある
async function ensureUserProfile(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_setting')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

// 応答が付かなかった質問を、末尾の1件だけ残して掃除する。
//
// 応答がDBに書かれない経路は2つある（ストリーミング中のリロード / 1文字も届かないうちの
// エラー）。どちらもリロードのたびに質問だけが1行積み上がり、同じ問いが3つ4つと並ぶ。
// 見た目が壊れるだけでなく、次のリクエストの文脈としても同じ問いを繰り返し送ることになる。
//
// 末尾の1件を残すのは、それが「まだ答えを待っている質問」だから。ここまで消すと
// 送信した文面ごと黙って消え、MessageBubble の「もう一度送信」も出せなくなる
async function pruneOrphanedMessages(msgs: Message[]): Promise<Message[]> {
  const orphanIds = msgs
    .filter((m, i) => m.role === 'user' && msgs[i + 1] !== undefined && msgs[i + 1]!.role !== 'assistant')
    .map(m => m.id)
  if (orphanIds.length === 0) return msgs

  try {
    await supabase.from('content_blocks').delete().in('message_id', orphanIds)
    await supabase.from('messages').delete().in('id', orphanIds)
  } catch (err) {
    // 消せなくても表示から外す。残しても次回のロードで再挑戦される
    console.error('宙に浮いた質問の削除に失敗しました', err)
  }
  return msgs.filter(m => !orphanIds.includes(m.id))
}

// content_blocks の1行。payload の形は type で決まる
type StoredBlockRow = {
  type:       string
  payload:    { content?: string; bodies?: BodyPerspective[] }
  sort_order: number
}

function toContentBlock(row: StoredBlockRow): ContentBlock {
  if (row.type === 'perspective') {
    // done を必ず立て直す。ストリーミング中の途中保存を読み戻したときに false のままだと、
    // 生成はとっくに終わっているのに MessageBubble がカーソル（▍）を点滅させ続ける
    return { type: 'perspective', bodies: (row.payload.bodies ?? []).map(b => ({ ...b, done: true })) }
  }
  return { type: 'text', content: row.payload.content ?? '' }
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, timestamp, signals, modality, content_blocks(type, payload, sort_order)')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: true })
  if (error) { console.error(error); return [] }

  const loaded = (data ?? []).map((row): Message => ({
    id: row.id as string,
    role: row.role as Message['role'],
    timestamp: new Date(row.timestamp as string),
    // 列が無い（ブロックD未適用）プロジェクトでも undefined になるだけで壊れない
    signals: (row.signals as TurnSignals | null) ?? undefined,
    blocks: (row.content_blocks as StoredBlockRow[])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toContentBlock),
    // 列が無い（ブロックD未適用）プロジェクトや、列追加より前に保存された行では
    // null になる。既定は 'text'（音声だったと誤認するより無難な側へ倒す）
    modality: (row.modality as Modality | null) ?? 'text',
  }))

  return pruneOrphanedMessages(loaded)
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
// このセッションで最後に送った user メッセージのid と、その保存/更新の promise。
// 言い直しで同じ行を書き換えるときに「対象がこれでよいか」「書き込みが終わったか」を見る
let lastSentUserId: string | null = null
let lastUserWrite: Promise<unknown> | null = null

let inFlight: StoppableController | null = null

// ストリーミング中に応答を保存し直す最短間隔。
// 1回の保存で messages の UPDATE と content_blocks の入れ替えが走るため、短くするほど
// 往復が増える。リロードで失う量（最大この長さぶん）との釣り合いで決めている
const STREAM_SAVE_INTERVAL_MS = 2000

// 中断の理由。同じ「中断」でも、保存してよいものと絶対に保存してはいけないものがある。
//   user   … 停止ボタン・バージイン。ユーザーが明示的に止めた
//   switch … 会話切替・新規会話。止めた先は別の会話なので、ここで保存すると
//            切り替え先の会話へ誤って書き込む
//   resend … 次の送信による自己中断。同じ器に新しい応答が入るので保存は不要
export type AbortReason = 'user' | 'switch' | 'resend'

// 理由は「中断されたリクエスト自身」に持たせる。モジュール変数に置くと、
// 古いリクエストのcatchが走る前に次のstopGenerationが理由を上書きしうる
type StoppableController = AbortController & { abortReason?: AbortReason }

// 進行中の応答があれば中断する。無ければ何もしない。
// UIの状態もここで戻す。中断されたリクエスト自身のfinallyに任せると、
// 「新しい送信が始まった直後に古い方のfinallyがidleへ戻す」競合が起きる
function stopGeneration(reason: AbortReason): void {
  if (!inFlight) return
  inFlight.abortReason = reason
  inFlight.abort()
  inFlight = null
  aiState.value = 'idle'
  pendingBodies.value = []
}

// ユーザーが「停止」を押したとき用。中断に加えて、まだ一文字も書かれていない
// 応答の器（空のアシスタントメッセージ）を画面から取り除く。
// 取り除かないと発言者名だけのバブルが残り、しかも直前のユーザー発言が
// 「応答済み」に見えるせいで送り直す導線（orphaned判定）も出てこない。
//
// stopGeneration 側でこれをやってはいけない。あちらは sendMessage が
// 新しいメッセージをpushした直後にも呼ぶため、今まさに使う器を消してしまう。
//
// バージイン（AIが喋っている最中に話しかける）も ChatView の handleBargeIn 経由で
// ここへ来る。どちらも「今の答えは要らなかった」という同じ事実なので、
// interrupted は区別せず1つに寄せる（I0：推論を挟まず観測できた事実だけを記録する）
function cancelGeneration(): void {
  if (!inFlight) return

  const last = messages.value.at(-1)

  // 止める「前」に刻む。stopGeneration の後だと、中断の catch → finally →
  // persistMessage が走る順序に依存することになる
  if (last?.role === 'assistant') {
    last.signals = { ...(last.signals ?? NO_SIGNALS), interrupted: true }
  }

  stopGeneration('user')

  // 画面からは取り除くが、器そのものは sendMessage 側が参照を持ったままなので
  // persistMessage には届く（本文が無くても signals があれば保存される）
  const written = last?.blocks.some(b => b.type === 'text' && b.content.length > 0)
  if (last?.role === 'assistant' && !written) messages.value.pop()
}

async function switchConversation(id: string): Promise<void> {
  // 切り替え前に止める。止めないと、前の会話のストリームが
  // 新しい会話の画面へ書き込みを続ける
  stopGeneration('switch')
  currentConversationId.value = id
  messages.value = await fetchMessages(id)
}

// 「新規会話」ボタン用のフラグ。trueの間は、次にensureConversationが呼ばれても
// 既存の会話を再利用せず、新しい会話を作る（＝最初のメッセージが送られるまでDBには何も書き込まない）
let pendingNewConversation = false

// 画面をまっさらな状態に戻すだけで、conversationsテーブルへの書き込みは行わない。
// 実際に会話が作られるのは、ここから最初のメッセージが送信されたタイミング（persistMessage経由）
function startNewConversation(): void {
  stopGeneration('switch')
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

// 保存済みのメッセージを書き換える。用途は2つ。
//   1. 言い直しで user の本文を置き換える
//   2. ストリーミング中の assistant を、伸びた本文で上書きする（途中保存）
//
// DBへ書くブロック行を組み立てる。
//
// text に加えて perspective も永続化する。副体の見解は「3つの知性が同じ問いで割れる
// 瞬間」そのもので、ThreeBody が文脈なしに見て分かる唯一の出力（ROADMAP 0章）。
// 表示だけして捨てていたためリロードで消え、「どの体が何と言ったか」を後から確かめる
// 手段が無かった。ROADMAP ③の共有カードもこのデータが正本になる。
//
// error だけは今も捨てる。表示専用の一時情報であり、DBの enum にも値が無い。
//
// sort_order は blocks 配列の位置そのもの。perspective は body_start で unshift される
// ため先頭に来る＝読み込み時も見解カードが本文の上に戻る
type BlockRow = {
  message_id: string
  type:       'text' | 'perspective'
  payload:    { content: string } | { bodies: BodyPerspective[] }
  sort_order: number
}

function toBlockRows(message: Message): BlockRow[] {
  return message.blocks.flatMap((b, i): BlockRow[] => {
    const base = { message_id: message.id, sort_order: i }
    if (b.type === 'text')        return [{ ...base, type: 'text',        payload: { content: b.content } }]
    if (b.type === 'perspective') return [{ ...base, type: 'perspective', payload: { bodies: b.bodies } }]
    return []
  })
}

// 本文と見解は別々の insert に分ける。
//
// 1つの配列で送ると PostgREST が単一トランザクションで実行するため、見解が弾かれた
// 瞬間に本文まで巻き添えで落ちる。enum に 'perspective' を足す前は実際にこれが起きて
// いて（22P02）、messages 行だけが残り content_blocks が0件になり、応答が画面から
// 丸ごと消えていた（MessageList.vue が0ブロックを描画対象から外すため）。
//
// 本文の失敗は throw する。読めない応答が残るので呼び出し側に知らせる必要がある。
// 見解の失敗は throw しない。見解は本文の付随物であり、これを理由に本文まで
// 「保存できなかった」ことにする理由が無い。握り潰さずログには必ず残す
async function insertBlockRows(rows: BlockRow[]): Promise<void> {
  const textRows  = rows.filter(r => r.type === 'text')
  const extraRows = rows.filter(r => r.type !== 'text')

  if (textRows.length > 0) {
    const { error } = await supabase.from('content_blocks').insert(textRows)
    if (error) throw error
  }

  if (extraRows.length > 0) {
    const { error } = await supabase.from('content_blocks').insert(extraRows)
    if (error) console.error('見解の保存に失敗しました（本文は保存済み）', error)
  }
}

// prevWrite は「その行を作った insert」。まだ終わっていないうちに UPDATE を投げると
// 対象行がまだ存在せず0件ヒットになり、古い本文が残る。必ず待ってから書き換える
// （呼び出し側で既に直列化してある場合は null でよい）
async function updatePersistedMessage(message: Message, prevWrite: Promise<unknown> | null): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  // ブロックの読み取りは await より前に1回だけ。理由は persistMessage 側に書いてある
  const blockRows = toBlockRows(message)
  const content   = flattenText(message.blocks)

  await prevWrite?.catch(() => undefined)

  const { error: msgErr } = await supabase
    .from('messages')
    .update({
      content,
      signals:   hasSignal(message.signals) ? message.signals : null,
      modality:  message.modality,
      timestamp: message.timestamp.toISOString(),
    })
    .eq('id', message.id)
  if (msgErr) throw msgErr

  // 差分を取らず、毎回まるごと入れ替える。ブロックは多くても見解1つ＋本文1つなので、
  // 差分計算に見合わない
  const { error: delErr } = await supabase.from('content_blocks').delete().eq('message_id', message.id)
  if (delErr) throw delErr

  if (blockRows.length > 0) await insertBlockRows(blockRows)
}

// エラーブロックは一時的な表示のみ。DBのblock_type enumに'error'が無いため永続化しない
async function persistMessage(message: Message): Promise<void> {
  const { user } = useAuth()
  if (!user.value) return

  // message.blocks は「まだ書き換わっている途中の器」であり、この関数は saveProgress から
  // ストリーミング中にも呼ばれる（＝読むたびに中身が違う）。await を跨いで2回読むと、
  // content と content_blocks がずれたままDBに入る。
  //
  // 実測（2026-08-19）: content 256文字 / content_blocks 252文字。差分は「最も理解」の
  // 4文字で、ensureConversation を待つ間に届いたぶんだった。
  //
  // 読むのは await より前に1回だけ。以降はこの写しだけを使う
  const blockRowsToWrite = toBlockRows(message)
  const content          = flattenText(message.blocks)

  // 本文が無くても、シグナルが立っていれば保存する。
  // 一文字も書かれないうちに停止されたケースは「答えが要らなかった」という最も強い
  // シグナルであり、ここで捨てると I0 が一番拾いたい情報を取りこぼす。
  //
  // 見解だけの状態（副体は答えたが統合が失敗した）も保存する。どの体が何と言ったかは
  // 統合が無くても読む価値があり、むしろ失敗時ほど残っていてほしい。
  // 中身もシグナルも無いものだけが、記録する価値のない空メッセージ
  if (blockRowsToWrite.length === 0 && !hasSignal(message.signals)) return

  const convId = await ensureConversation(user.value.id)

  const { data: inserted, error: msgErr } = await supabase
    .from('messages')
    .insert({
      // クライアントで採番した id をそのまま主キーにする。
      // DB の gen_random_uuid() に任せると画面上の Message と DB 行が別idになり、
      // あとから「あの発言を書き換える」ができない（言い直しの反映に必要）
      id:         message.id,
      conversation_id: convId,
      role:       message.role,
      content,
      // シグナルが立っていないメッセージには書かない。全行に既定値を入れると
      // 「何も起きなかった」と「まだ記録していない」が区別できなくなる
      signals:    hasSignal(message.signals) ? message.signals : null,
      modality:   message.modality,
      timestamp:  message.timestamp.toISOString(),
    })
    .select('id')
    .single()
  if (msgErr) throw msgErr

  // 0文字で停止された場合、ブロックは空になる（本文も見解も無く signals だけが残る）。
  // 空配列を insert する意味は無いので送らない
  if (blockRowsToWrite.length > 0) {
    await insertBlockRows(blockRowsToWrite.map(r => ({ ...r, message_id: inserted.id as string })))
  }

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

  async function sendMessage(text: string, modality: Modality='text') {
    // 直前が user のまま＝その発言に応答が付いていない（バージインや停止で捨てられた）。
    // このとき次の発話は「新しい問い」ではなく「言い直し」なので、並べずに置き換える。
    // 並べると同じ主旨の断片が2つ残り、履歴としても次のリクエストの文脈としても壊れる。
    //
    // 連結ではなく置換にしているのは、人は言い直すとき最初から言い直すため。
    // 連結すると必ず重複した文が残る。
    //
    // このセッションで自分が送ったものに限る（lastSentUserId）。リロード直後に残って
    // いた古い孤立メッセージまで書き換えると、無関係な過去の質問が消える
    const last = messages.value.at(-1)
    const orphan = last?.role === 'user' && last.id === lastSentUserId ? last : null

    let userMsg: Message
    if (orphan) {
      const prevWrite = lastUserWrite
      orphan.blocks = [{ type: 'text', content: text }]
      orphan.timestamp = new Date()
      orphan.modality = modality
      // 失われた1回目の本文は残さないが、「言い直した」という事実だけは記録する。
      // I0 の rephrased はこのために用意した列
      orphan.signals = {
        ...(orphan.signals ?? NO_SIGNALS),
        rephrased: (orphan.signals?.rephrased ?? 0) + 1,
      }
      userMsg = orphan
      lastUserWrite = updatePersistedMessage(orphan, prevWrite)
        .catch(err => console.error('メッセージの更新に失敗しました', err))
    } else {
      userMsg = {
        id: createId(),
        role: 'user',
        blocks: [{ type: 'text', content: text }],
        timestamp: new Date(),
        modality,
      }
      messages.value.push(userMsg)
      lastUserWrite = persistMessage(userMsg)
        .catch(err => console.error('メッセージの保存に失敗しました', err))
    }
    lastSentUserId = userMsg.id

    messages.value.push({
      id: createId(),
      role: 'assistant',
      blocks: [{ type: 'text', content: '' }],
      // new Date() ではなく「質問の1ミリ秒後」。
      //
      // 履歴の並びは fetchMessages の order('timestamp') だけで決まる。ここを new Date()
      // にすると、上の userMsg 生成との間に await が1つも無いため同じミリ秒に落ちることが
      // あり、同着になった瞬間にDB側の返す順序が保証されなくなる（実測で、応答が質問の
      // 上に表示された）。1ms 足して、必ず質問の後ろに来ることを値で保証する
      timestamp: new Date(userMsg.timestamp.getTime() + 1),
      // 応答側は入力と同じ経路で返す。声で聞かれたら読み上げ、文字で打たれたら
      // 読み上げない（ChatView が TextComposer では useVoiceNarration を起動しない）
      modality,
      streaming: true,
    })

    // push後にリアクティブ配列経由で参照することで Vue の Proxy を通す
    const reactiveMsg = messages.value[messages.value.length - 1]!
    const block = reactiveMsg.blocks[0] as TextBlock

    // 前の応答がまだ流れていれば止めてから始める（多重ストリームを作らない）
    stopGeneration('resend')
    const controller: StoppableController = new AbortController()
    inFlight = controller
    // aborted は「中断されたか」、abortReason は「なぜ中断されたか」。
    // 2つに分けているのは、理由が取れないケース（null）でも中断自体は成立するため。
    // 1つにまとめると null が「中断されていない」と見分けられなくなる
    let aborted = false
    let abortReason: AbortReason | null = null

    // ── 応答の途中保存 ────────────────────────────────────────────────────────
    // 応答の保存が finally 一点しか無いと、ストリーミング中にリロードされた瞬間に
    // 画面に出ていた本文が丸ごと消える（JSコンテキストごと落ちるので finally は走らない）。
    // 質問の行だけがDBに残り、MessageList.isOrphaned で宙に浮く。
    //
    // savedRow は「DBに行を作ったか」。1回目は insert、2回目以降は id を指す update。
    // pendingWrite に繋いで直列化しているのは、insert の完了前に2回目が走ると
    // 同じ主キーで二重 insert になるため（awaitを跨いで savedRow を読ませない）
    let savedRow    = false
    let savedLength = 0
    let pendingWrite: Promise<unknown> | null = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    function saveProgress(): void {
      const prev = pendingWrite
      pendingWrite = (async () => {
        await prev?.catch(() => undefined)
        const content = block.content
        // 一文字も届いていないうちは行を作らない（空バブルをDBに残さない）。
        // 前回から伸びていなければ書く意味も無い
        if (!content || content.length === savedLength) return
        if (savedRow) await updatePersistedMessage(reactiveMsg, null)
        else { await persistMessage(reactiveMsg); savedRow = true }
        savedLength = content.length
      })().catch(err => console.error('応答の保存に失敗しました', err))
    }

    // 先頭で即保存し、そのあとを間引く（leading edge のスロットリング）。
    //
    // 後追いだけにすると、最初の1回が来るまでの間はリロードで丸ごと消える。三体モードは
    // 副体ラウンドの間 block.content が空のままなので、体感の「長い応答」のうち
    // 保存が一度も走らない区間がかなり長い。行さえ先に作れば以降は update で追いつける。
    //
    // デバウンスではなくスロットリングなのは、デバウンスだとトークンが途切れず届く間は
    // タイマーが延び続けて一度も保存されない（＝長い応答ほど守られない）ため
    function scheduleSave(): void {
      if (saveTimer !== null) return
      saveProgress()
      saveTimer = setTimeout(() => { saveTimer = null; saveProgress() }, STREAM_SAVE_INTERVAL_MS)
    }

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
          useSharedKey: settings.useSharedKey,
          bodies: settings.bodies.map(b => ({
            provider: b.provider,
            apiKey: b.apiKey,
            model: b.model,
            // 副体の指示文と表示名は backend が role から組む（llm/secondaryPrompt.ts）。
            // ここで文面を作って送ると、共有キー経路との二重管理に戻る
            role: b.role,
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
              scheduleSave()
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

      // 中断はユーザー起因（停止・バージイン・会話切替・新規会話・次の送信）なので
      // エラーではない。ここで抜けることで、エラーブロックの表示と、切り替え先の
      // 会話への誤った永続化（下のfinally）の両方を避ける。
      //
      // どの理由で止まったかは中断されたリクエスト自身が持っている（StoppableController）。
      // 理由が取れないのは stopGeneration を経由しない中断だけで、その場合は
      // 保存しない側（現状維持）へ倒す
      if (err instanceof DOMException && err.name === 'AbortError') {
        aborted = true
        abortReason = controller.abortReason ?? null

        // 保存しないと決めた空の器は、配列からも取り除く。
        //
        // 残すと、画面には出ないのに messages.value には居座り続ける幽霊になる
        // （MessageList の visibleMessages が0ブロックを描画対象から外すため）。
        // 実害は表示ではなく履歴で、toApiMessages が {role:'assistant', content:''}
        // として毎回LLMへ送ってしまう。空のアシスタントターンは文脈を汚すだけで、
        // 送る理由がひとつも無い。
        //
        // 'user' はここで触らない。cancelGeneration が先に画面から外しており、
        // 器そのものは persistMessage に渡す必要がある（signals だけを残すため）。
        //
        // at(-1) ではなく indexOf で消すこと。'resend' の場合、この catch が走る時点で
        // 配列の末尾は既に次の送信ぶんに変わっている。
        // 'switch' では messages.value ごと差し替わっていて見つからないが、
        // その場合は -1 が返るだけで何も起きない
        if (abortReason !== 'user' && reactiveMsg.blocks.length === 0) {
          const ghostIndex = messages.value.indexOf(reactiveMsg)
          if (ghostIndex !== -1) messages.value.splice(ghostIndex, 1)
        }
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

      // 中断されたぶんを保存してよいのは「ユーザーが明示的に止めた」ときだけ。
      //
      // persistMessage → ensureConversation は「今表示している会話」を返すため、
      // 会話切替('switch')による中断でここを通すと、切り替え先の会話へ前の会話の
      // 応答を書き込む。理由が取れない(null)場合も同じ事故を避けて保存しない。
      // 'resend' は同じ器に新しい応答が入るので保存する意味がない。
      //
      // 'user' が安全なのは、止めた時点で会話が切り替わっていないため。
      // これで「停止 → リロードで応答が消える」が解消する（途中まで書かれた本文は残る。
      // 一文字も書かれていなければ catch が空ブロックを外すので persistMessage が
      // 早期 return し、発言者名だけの空バブルはDBに残らない）
      if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }

      // 行をまだ作っていない場合だけ、上のルールが効く。
      // 既に途中保存で行がある場合は理由に関わらず最後の状態へ揃える。update は id で
      // 引くので、会話が切り替わっていても書き込み先を間違えない（insert と違って
      // ensureConversation を通らない）。ここで揃えないと、DBには2秒前の途中までが
      // 残り、画面に出ている最後の数文が永久に欠ける
      const mayInsert = !aborted || abortReason === 'user'
      if (mayInsert || savedRow) saveProgress()
      // 共有キーを使った場合、残り回数がここで変わる。UIの表示を最新に保つ
      if (mayInsert) void refreshCapabilities()
    }
  }

  // 応答が欠けたまま宙ぶらりんになったユーザーメッセージを、削除した上で送り直す
  async function retryMessage(message: Message): Promise<void> {
    const text = flattenText(message.blocks)
    await deleteMessage(message.id)
    if (text.trim()) await sendMessage(text)
  }

  return {
    messages, sendMessage, stopGeneration, cancelGeneration, aiState, pendingBodies, openConversation, deleteMessage, retryMessage,
    conversations, currentConversationId, currentConversation,
    startNewConversation, deleteConversation, renameConversation,
  }
}
