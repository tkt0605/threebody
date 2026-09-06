// 検算フローを、認証もフロントも通さずに1往復だけ動かして中身を読む。
//
// 【なぜ要るか】
// 検算の良し悪しは自動判定できない。「指摘が答えに実際に書かれている中身を指しているか」は
// 答えとカードを並べて人が読むしかない（docs/ROADMAP.md ②の完了判定）。
// /api/chat 経由だと Supabase のアクセストークンが要り、レートリミットにも当たるため、
// orchestrateMultiBody を直接叩いて SSE を組み立て直す。
//
//   npx tsx scripts/preview-review.ts
//   npx tsx scripts/preview-review.ts gemma4 'WebSocketでチャット、どう設計する？'
import 'dotenv/config'
import { searchEnabled } from '../backend/tools/webSearch'
import type express from 'express'
import { orchestrateMultiBody } from '../backend/llm/textService'
import type { BodyConfig, LevelConfig } from '../backend/llm/types'

const MODEL    = process.argv[2] ?? process.env.OLLAMA_MODEL_DEFAULT!
const QUESTION = process.argv[3] ?? 'WebSocketでチャット、どう設計する？'

// 主体1・副体2。既定の並びに合わせて skeptic → realist
const bodies: BodyConfig[] = [
  { provider: 'ollama', apiKey: '', model: MODEL },
  { provider: 'ollama', apiKey: '', model: MODEL, role: 'skeptic' },
  { provider: 'ollama', apiKey: '', model: MODEL, role: 'realist' },
]
// LEVEL_CONFIG[3] と同じ配分（副体1536 / 主体8192）
const config: LevelConfig = {
  anthropicModel: '', openaiModel: '', deepseekModel: '', ollamaModel: MODEL,
  maxTokens: 8192, secondaryMaxTokens: 1536,
}
const PERSONA = 'あなたはアイリス（I.R.I.S）。tkt0605が開発したAIだ。日本語で話す。温かく共感的な口調で話す。'

const order: string[] = []
let answer = ''
const cards = new Map<number, { name: string; text: string }>()

// SSE を受ける側の最小実装。フロント（useChat.ts）が見ているのと同じイベントだけを拾う
const res = {
  write(chunk: string) {
    const ev = JSON.parse(chunk.replace(/^data: /, '').trim()) as
      { type: string; content?: string; bodyIndex?: number; name?: string; review?: boolean }
    const label = ev.type + (ev.review !== undefined ? `(review:${ev.review})` : '')
    if (order.at(-1) !== label) order.push(label)
    if (ev.type === 'text') answer += ev.content
    if (ev.type === 'body_start') cards.set(ev.bodyIndex!, { name: ev.name!, text: '' })
    if (ev.type === 'body_text') cards.get(ev.bodyIndex!)!.text += ev.content
    return true
  },
} as unknown as express.Response

async function main() {
  console.log(`Web検索: ${searchEnabled() ? '有効' : '無効（SEARCH_API_URL 未設定）'}`)
  const t0 = Date.now()
  await orchestrateMultiBody(bodies, bodies, [{ role: 'user', content: QUESTION }], config, PERSONA, res, { webSearch: Boolean(searchEnabled()) })

  console.log(`\nSSEの並び: ${order.join(' → ')}`)
  console.log(`所要 ${Math.round((Date.now() - t0) / 1000)}秒  model=${MODEL}\n`)
  console.log(`${'='.repeat(70)}\n[主体の答え] ${answer.length}字\n${'='.repeat(70)}\n${answer.trim()}`)
  for (const [i, c] of cards) {
    console.log(`\n${'-'.repeat(70)}\n[検算カード #${i}] ${c.name}\n${'-'.repeat(70)}\n${c.text.trim() || '（空）'}`)
  }
}

void main()
