export type MessageRole = 'user' | 'assistant'

export type TextBlock = {
  type: 'text'
  content: string
  // 三体モードでどの体（一体/二体/三体）が生成した回答かを示す（役割別カラー分けに使用）
  bodyIndex?: number
}

export type ErrorBlock = { type: 'error'; message: string }

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
