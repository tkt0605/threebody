export type MessageRole = 'user' | 'assistant'

export type TextBlock = {
  type: 'text'
  content: string
}

// Future block types
export type ImageBlock = { type: 'image'; url: string; alt?: string }
export type MapBlock = { type: 'map'; lat: number; lng: number; zoom?: number }
export type GameBlock = { type: 'game'; gameId: string }

export type ContentBlock = TextBlock | ImageBlock | MapBlock | GameBlock

export type Message = {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
  timestamp: Date
  streaming?: boolean
}
