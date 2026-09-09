import { ref } from 'vue'
import type { ContentBlock } from '../types/message'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { toContentBlocks, type StoredBlockRow } from '../lib/contentBlocks'

// 1ターンの公開（ROADMAP ③）。
//
// 【この機能の存在理由】閲覧側はLLMを呼ばない。何人見ても無料枠が1回も減らないため、
// 拡散とコストを切り離せる唯一の経路になる（ROADMAP 2章「律速は資金」）。
// だから閲覧は自前サーバーを通さず、publishable key で Supabase を直接読む。
//
// 【公開の単位】主体の答え（message_id）と、その問い（question_message_id）。
// 検算カードは答えの content_blocks に 'perspective' として入っているので、
// 追加で送るものは無い。
//
// 【既定は非公開】会話はユーザーの私物。匿名閲覧者は、公開してよい内容だけを複製した
// published_turns の生きた1行だけを読む。所有者や元メッセージの内部IDは公開経路に出さない。

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
  // 公開スナップショットだけを1回読む。shared_messages / messages / content_blocks は
  // 匿名経路から触らないため、所有者ID・元メッセージID・操作記録へ到達できない。
  // 取り消し済みの行は published_turns_select_public が0件にする。
  async function fetchByToken(token: string): Promise<SharedTurn | null> {
    const { data: snapshot, error } = await supabase
      .from('published_turns')
      .select('token, question, answer, content_blocks, created_at')
      .eq('token', token)
      .maybeSingle()
    if (error) { console.error('共有の取得に失敗しました', error); return null }
    if (!snapshot) return null

    const blocks = toContentBlocks(
      (snapshot.content_blocks as StoredBlockRow[] | null) ?? []
    )
    // content_blocks 導入前の共有にも本文を表示する。通常は text 行があるため追加しない。
    if (!blocks.some(block => block.type === 'text')) {
      blocks.unshift({ type: 'text', content: snapshot.answer as string })
    }

    return {
      token:    snapshot.token as string,
      question: (snapshot.question as string | null) ?? null,
      blocks,
      sharedAt: new Date(snapshot.created_at as string),
    }
  }

  return { liveTokens, pending, loadLiveTokens, tokenFor, share, revoke, fetchByToken }
}
