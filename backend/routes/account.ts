import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveUserId } from '../auth'
import { getSupabaseAdmin } from '../supabaseAdmin'

// 退会（アカウントと全データの削除）。
//
// 【なぜバックエンドに置くか】auth.users の行はフロントの anon key では消せない。
// service_role でしか消せないため、削除の入口はここにしか作れない。
// 会話単位の削除（useChat.deleteConversation）がフロント完結なのは、そちらが
// RLS の範囲内で完結する操作だからで、退会は範囲が違う。
//
// 【削除の範囲】individual → 個人情報保護法の「消去の請求」に応じられる状態にすること。
// アカウント（auth.users）、プロフィール（user_setting）、会話、メッセージ、
// ブロック、エラー報告のすべてを消す。
const router = Router()

// 退会は本来1アカウントにつき1回しか起きない。連打・自動化を弾く粗い上限。
// 削除は元に戻せないため、失敗して数回やり直す余地だけ残す。
// export しているのはテストがIP単位のカウンタをリセットするため（本番の意味は変わらない）
export const deleteRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit:    5,
  standardHeaders: true,
  legacyHeaders:   false,
})

// アプリ側のデータを、外部キーの参照が切れない順（子 → 親）に消す。
//
// 【なぜ ON DELETE CASCADE に任せないか】docs/schema.sql は本番からのダンプではなく
// コードから再構築したもので、本番に CASCADE が実際に付いているかを保証できない。
// もし付いていなければ、auth.users だけ消えて会話が孤児として残る——つまり
// 「退会したのに会話内容は残っている」という、最も避けたい失敗の仕方をする。
// ここで明示的に消しておけば、CASCADE の有無にかかわらず結果は同じになる。
//
// export しているのはテストから直接叩くため
export async function deleteUserData(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: convs, error: convErr } = await admin
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
  if (convErr) throw convErr

  const convIds = (convs ?? []).map(c => c.id as string)

  if (convIds.length > 0) {
    const { data: msgs, error: msgSelErr } = await admin
      .from('messages')
      .select('id')
      .in('conversation_id', convIds)
    if (msgSelErr) throw msgSelErr

    const msgIds = (msgs ?? []).map(m => m.id as string)
    if (msgIds.length > 0) {
      const { error } = await admin.from('content_blocks').delete().in('message_id', msgIds)
      if (error) throw error
    }

    const { error: msgDelErr } = await admin.from('messages').delete().in('conversation_id', convIds)
    if (msgDelErr) throw msgDelErr

    const { error: convDelErr } = await admin.from('conversations').delete().in('id', convIds)
    if (convDelErr) throw convDelErr
  }

  const { error: fbErr } = await admin.from('feedback').delete().eq('user_id', userId)
  if (fbErr) throw fbErr

  // 無料お試し枠の消費記録もここで消える。全体カウンタ
  // （shared_key_global_usage）は個人に紐づかない集計値なので触らない
  const { error: settingErr } = await admin.from('user_setting').delete().eq('id', userId)
  if (settingErr) throw settingErr
}

router.delete('/account', deleteRateLimit, async (req, res) => {
  const userId = await resolveUserId(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: '認証が必要です' })
    return
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    // 環境変数が無い＝service_roleが使えない。ここで500を返すと「一時的な不具合」に
    // 見えるが、実際は設定の不備で何度やっても成功しない
    res.status(503).json({ error: 'アカウント削除は現在利用できません' })
    return
  }

  try {
    // データを先に消し、最後にアカウント本体を消す。
    // 逆順にすると、途中で失敗したときに「ログインできないのにデータは残る」
    // ——自分では消せない状態になる
    await deleteUserData(admin, userId)

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw error

    res.status(204).end()
  } catch (err) {
    // 例外の生の中身はログにも応答にも出さない（他所と同じ方針）
    console.error('[account] アカウントの削除に失敗しました:', err instanceof Error ? err.message : 'unknown')
    res.status(500).json({ error: 'アカウントの削除に失敗しました' })
  }
})

export default router
