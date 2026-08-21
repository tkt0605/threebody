import type { BodyPerspective, ContentBlock } from '../types/message'

// content_blocks の1行を、表示に使う ContentBlock へ戻す。
//
// 読む側が2つある（自分の会話 = useChat.ts / 共有ページ = useSharedTurn.ts）ため、
// 変換だけをここへ出してある。書く側（toBlockRows）は永続化の手順と一体なので
// useChat.ts に残す
export type StoredBlockRow = {
  type:       string
  payload:    { content?: string; bodies?: BodyPerspective[] }
  sort_order: number
}

export function toContentBlock(row: StoredBlockRow): ContentBlock {
  if (row.type === 'perspective') {
    // done を必ず立て直す。ストリーミング中の途中保存を読み戻したときに false のままだと、
    // 生成はとっくに終わっているのに MessageBubble がカーソル（▍）を点滅させ続ける
    return { type: 'perspective', bodies: (row.payload.bodies ?? []).map(b => ({ ...b, done: true })) }
  }
  return { type: 'text', content: row.payload.content ?? '' }
}

// sort_order の昇順で ContentBlock へ。順序は blocks 配列の位置そのものなので、
// 検算カード（perspective）は本文の下に戻る
export function toContentBlocks(rows: StoredBlockRow[]): ContentBlock[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order).map(toContentBlock)
}
