import type { Message } from '../types/message'

// 答えの付いていないユーザー発言に、何が起きたのかを判定する。
//
//   'stopped-empty'   … ユーザーが自分で止めた（停止ボタン・バージイン）。本文はまだ一文字も無い
//   'stopped-partial' … ユーザーが自分で止めた。途中までの本文は残っている
//   'lost'            … 応答が届かなかった（エラー、保存前の離脱）
//   null              … 孤立していない
//
// 判定には all（画面に出す前の全メッセージ）を渡すこと。MessageList の visibleMessages
// （blocks.length>0 だけを描画対象にした配列）を渡してはいけない。一文字も出ないうちに
// 終わった応答は0ブロックなのでそこから除外されており、その行こそが signals.interrupted
// という理由を持っているため
export type OrphanReason = 'stopped-empty' | 'stopped-partial' | 'lost' | null

export function orphanReason(msg: Message, all: Message[]): OrphanReason {
  if (msg.role !== 'user') return null

  const next = all[all.indexOf(msg) + 1]

  // 応答の器すら無い＝保存される前に失われた
  if (!next || next.role !== 'assistant') return 'lost'

  // 止めたのなら interrupted が立っている（useChat.cancelGeneration）。
  // 中身の有無に関わらず「止めた」ことが確定しているので、blocks.length のチェックより先に見る
  if (next.signals?.interrupted) return next.blocks.length > 0 ? 'stopped-partial' : 'stopped-empty'

  // 中身のある応答が続いていれば孤立ではない
  if (next.blocks.length > 0) return null

  return 'lost'
}
