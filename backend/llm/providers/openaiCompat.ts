import type express from 'express'
import OpenAI from 'openai'
import type { BodyConfig } from '../types'

// openai/deepseek専用。Ollamaはネイティブ /api/chat を直接叩くためここは通らない
export function createOpenAICompatClient(body: BodyConfig): OpenAI {
  const baseURLs: Record<string, string | undefined> = {
    deepseek: 'https://api.deepseek.com',
  }
  return new OpenAI({ apiKey: body.apiKey, baseURL: baseURLs[body.provider] })
}

export async function streamOpenAICompat(
  client: OpenAI,
  model: string,
  res: express.Response,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens: number,
  systemPrompt: string,
) {
  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : []

  const stream = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [...systemMessages, ...messages],
    stream: true,
  })

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
    }
  }
}
