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
): Promise<string> {
  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : []

  const stream = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [...systemMessages, ...messages],
    stream: true,
  })

  // 本文を戻り値でも返す。副体はこの答えを読んで検算するため、呼び出し側が全文を持つ
  // 必要がある（res へ書くだけでは、書いた内容が誰の手元にも残らない）
  let full = ''
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      full += content
      res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
    }
  }
  return full
}
