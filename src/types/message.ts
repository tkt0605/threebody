import type { Modality, TurnSignals } from './intent'

export type MessageRole = 'user' | 'assistant'

export type TextBlock = {
  type: 'text'
  content: string
  // 三体モードでどの体（一体/二体/三体）が生成した回答かを示す（役割別カラー分けに使用）
  bodyIndex?: number
}

// エラー報告に添える実行時コンテキスト。
// providers はプロバイダー名のみ。BodyConfig には apiKey が含まれるため丸ごと入れない
export type ErrorReportContext = {
  raw: string
  display: string
  thinkingLevel: number
  providers: string[]
  conversationId: string | null
  userAgent: string
  occurredAt: string
}

// context はDB非永続化のエラーブロックにのみ載る一時データ。
// 判別子 type:'error' を持つブロックはこの1種類だけにする（同じ判別子の型を複数作ると
// block.type === 'error' で絞り込んでも context に到達できなくなるため）
export type ErrorBlock = {
  type: 'error'
  message: string
  context?: ErrorReportContext
}

// 三体モード: 副体（二体・三体）による、主体の答えへの検算。
// 主体が答え終わってから流れてくるので、本文ブロックの後ろに積まれる。
// ストリーミング中はリアルタイム表示に使い、応答の完了後は content_blocks へ
// type='perspective' で保存する（2026-08-19 以降。それ以前は表示専用で捨てていた）。
// 1メッセージにつき1行で、bodies 配列がそのまま payload になる（体ごとに行を分けない）
export type BodyPerspective = {
  bodyIndex: number
  name: string
  provider: string
  content: string
  done: boolean
  // この体が指摘を出したか。判定は backend（llm/secondaryPrompt.ts の hasReviewFinding）で
  // 済ませ、SSE の body_done で届く。本文の「指摘なし」という文字列を読む側それぞれが
  // 見に行くと、文面が揺れた瞬間に静かに壊れるため、構造として持たせる。
  // 省略可なのは、この列を足す前に保存されたブロックには入っていないため
  // （false ではなく「不明」。`| undefined` の明示は exactOptionalPropertyTypes のため）
  hasFinding?: boolean | undefined
}
export type PerspectiveBlock = { type: 'perspective'; bodies: BodyPerspective[] }

export type ContentBlock = TextBlock | ErrorBlock | PerspectiveBlock

export type Message = {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
  timestamp: Date
  streaming?: boolean
  // I0（記録）。ブロックではなくメッセージのメタデータなので content_blocks ではなく
  // messages.signals（jsonb）へ入れる。シグナルが立っていないメッセージには付かない。
  // `| undefined` を明示しているのは exactOptionalPropertyTypes が有効なため
  // （無いと「キーを持たない」ことしか許されず、undefined の代入が型エラーになる）
  signals?: TurnSignals | undefined,
  modality: Modality
}
