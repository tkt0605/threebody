import { ref } from 'vue'
import type { ContentBlock } from '../types/message'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { toContentBlocks } from '../lib/contentBlocks'

// 1ターンの公開（ROADMAP ③）。
//
// 【この機能の存在理由】閲覧側はLLMを呼ばない。何人見ても無料枠が1回も減らないため、
// 拡散とコストを切り離せる唯一の経路になる（ROADMAP 2章「律速は資金」）。
// だから閲覧は自前サーバーを通さず、anon key で Supabase を直接読む。
//
// 【公開の単位】主体の答え（message_id）と、その問い（question_message_id）。
// 検算カードは答えの content_blocks に 'perspective' として入っているので、
// 追加で送るものは無い。
//
// 【既定は非公開】会話はユーザーの私物で、shared_messages に生きた行がある
// 1メッセージだけが公開される。取り消し（revoked_at）は台帳側の1列で閉じ、
// messages と content_blocks の anon ポリシーが同時に効かなくなる（docs/schema.sql）

// 共有ページが表示するものすべて。所有者は含めない（誰が共有したかは公開しない）
export type SharedTurn = {
  token:    string
  question: string | null
  blocks:   ContentBlock[]
  sharedAt: Date
}

// message_id → token。自分が「いま公開しているもの」だけを持つ。
// Pinia は使わず、composables はモジュールレベルの singleton で揃える
const liveTokens = ref<Record<string, string>>({})
// 送信中の message_id。ボタンの二度押しを止めるためだけに持つ
const pending    = ref<string | null>(null)
const loaded     = ref(false)

// 共有URL。閲覧者が最初に見る文字列なので、会話IDもメッセージIDも出さない
export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
}

export function useSharedTurn() {
  // 自分の生きている共有をまとめて1回だけ引く。件数はユーザーが共有した数しか無いので、
  // 会話ごとに引き直さずアプリ全体で1回に畳む
  async function loadLiveTokens(): Promise<void> {
    const { user } = useAuth()
    if (!user.value || loaded.value) return

    const { data, error } = await supabase
      .from('shared_messages')
      .select('token, message_id')
      .eq('user_id', user.value.id)
      .is('revoked_at', null)
    if (error) { console.error('共有状態の取得に失敗しました', error); return }

    liveTokens.value = Object.fromEntries(
      (data ?? []).map(r => [r.message_id as string, r.token as string])
    )
    loaded.value = true
  }

  function tokenFor(messageId: string): string | null {
    return liveTokens.value[messageId] ?? null
  }

  // このメッセージの生きている共有をDBから引き直す。
  // 手元の liveTokens は「このタブが知っている範囲」でしかないため、衝突したときの
  // 拾い直しに使う
  async function refetchToken(messageId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('shared_messages')
      .select('token')
      .eq('message_id', messageId)
      .is('revoked_at', null)
      .maybeSingle()
    if (error || !data) return null

    const token = data.token as string
    liveTokens.value = { ...liveTokens.value, [messageId]: token }
    return token
  }

  // 公開する。既に公開済みならそのトークンを返す（同じターンにURLを2つ作らない）。
  //
  // questionMessageId は直前のユーザー発言。問いが無いと検算カードが何を指しているか
  // 読めず、5条件の1（単体で意味が分かる）が立たない
  async function share(messageId: string, questionMessageId: string | null): Promise<string | null> {
    const existing = tokenFor(messageId)
    if (existing) return existing

    const { user } = useAuth()
    if (!user.value || pending.value) return null

    pending.value = messageId
    try {
      const { data, error } = await supabase
        .from('shared_messages')
        .insert({
          message_id:          messageId,
          question_message_id: questionMessageId,
          user_id:             user.value.id,
        })
        .select('token')
        .single()

      // 生きている共有は1メッセージにつき1件（部分ユニーク index）。別のタブや端末で
      // 先に共有していると一意制約で弾かれるので、そのときは既にあるURLを拾い直す。
      // ここで新しい行を作れてしまうと、同じターンのURLが2つ出回る
      if (error?.code === '23505') return await refetchToken(messageId)
      if (error) throw error

      const token = data.token as string
      liveTokens.value = { ...liveTokens.value, [messageId]: token }
      return token
    } catch (err) {
      console.error('共有に失敗しました', err)
      return null
    } finally {
      pending.value = null
    }
  }

  // 公開をやめる。行は消さずに revoked_at を立てる。
  // 消してしまうと「共有していた事実」ごと消え、同じURLが再共有で復活しうる。
  // 部分ユニークが生きている行だけを見るので、再共有では新しい token が発行される
  async function revoke(messageId: string): Promise<boolean> {
    const token = tokenFor(messageId)
    if (!token || pending.value) return false

    pending.value = messageId
    try {
      const { error } = await supabase
        .from('shared_messages')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token', token)
      if (error) throw error

      const { [messageId]: _removed, ...rest } = liveTokens.value
      liveTokens.value = rest
      return true
    } catch (err) {
      console.error('共有の取り消しに失敗しました', err)
      return false
    } finally {
      pending.value = null
    }
  }

  // 未ログインで開かれる読み取り経路。ここだけは認証を前提にしない。
  //
  // 台帳を先に引き、そこで得た message_id でしか messages を読まない。
  // URLから受け取った文字列がそのまま messages の絞り込みに渡ることは無い
  // （＝共有していないメッセージのIDを直接叩いても、この関数からは到達できない）。
  // 二重の防御で、RLS 側も shared_messages に生きた行が無い限り0件を返す
  async function fetchByToken(token: string): Promise<SharedTurn | null> {
    const { data: ledger, error: ledgerError } = await supabase
      .from('shared_messages')
      .select('token, message_id, question_message_id, created_at')
      .eq('token', token)
      .is('revoked_at', null)
      .maybeSingle()
    if (ledgerError) { console.error('共有の取得に失敗しました', ledgerError); return null }
    if (!ledger) return null

    const answerId   = ledger.message_id as string
    const questionId = (ledger.question_message_id as string | null) ?? null

    const { data: rows, error: rowsError } = await supabase
      .from('messages')
      .select('id, role, content, content_blocks(type, payload, sort_order)')
      .in('id', questionId ? [answerId, questionId] : [answerId])
    if (rowsError) { console.error('共有の取得に失敗しました', rowsError); return null }

    const answer = (rows ?? []).find(r => r.id === answerId)
    // 台帳はあるのに本文が読めないのは、答えが消された（会話ごと削除）状態。
    // 取り消しと同じ扱いにして、共有ページは「見つからない」を出す
    if (!answer) return null

    const question = questionId
      ? ((rows ?? []).find(r => r.id === questionId)?.content as string | undefined) ?? null
      : null

    return {
      token:    ledger.token as string,
      question,
      blocks:   toContentBlocks(answer.content_blocks),
      sharedAt: new Date(ledger.created_at as string),
    }
  }

  return { liveTokens, pending, loadLiveTokens, tokenFor, share, revoke, fetchByToken }
}
