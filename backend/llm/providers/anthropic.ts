import type express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import type { LevelConfig } from '../types'

// 運営側のキーで動くクライアント。streamAnthropic の client 既定値として使う
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function streamAnthropic(
  res: express.Response,
  messages: Anthropic.MessageParam[],
  config: LevelConfig,
  systemPrompt: string,
  client: Anthropic = anthropic,
) {
  // Opus 4.7: budget_tokens は削除済み → adaptive thinking を使う
  // Sonnet 4.6 以下: thinkingBudget があれば enabled（非推奨だが機能する）
  const thinkingParam = config.adaptiveThinking
    ? { thinking: { type: 'adaptive' as const } }
    : config.thinkingBudget
      ? { thinking: { type: 'enabled' as const, budget_tokens: config.thinkingBudget } }
      : {}

  // messages.stream() を使う（create({ stream: true }) より型安全で取り扱いが容易）
  const stream = client.messages.stream({
    model:      config.anthropicModel,
    max_tokens: config.maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...thinkingParam,
  })

  // textStream は thinking ブロックを自動的にスキップしてテキストのみ流す
  stream.on('text', (textDelta) => {
    res.write(`data: ${JSON.stringify({ type: 'text', content: textDelta })}\n\n`)
  })
  await stream.finalMessage()
}
