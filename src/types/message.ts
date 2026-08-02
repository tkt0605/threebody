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

// 三体モード: 副体（二体・三体）の見解をリアルタイムに表示するための一時的なブロック（DBには保存しない）
export type BodyPerspective = {
  bodyIndex: number
  name: string
  provider: string
  content: string
  done: boolean
}
export type PerspectiveBlock = { type: 'perspective'; bodies: BodyPerspective[] }

export type ContentBlock = TextBlock | ErrorBlock | PerspectiveBlock

export type Message = {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
  timestamp: Date
  streaming?: boolean
}
