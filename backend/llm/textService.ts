import type express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BodyConfig, LevelConfig } from './types'
import { resolveBodyModel, toOllamaMessages, toAnthropicMessages } from './messageHelpers'
import { streamOllamaNative } from './providers/ollama'
import { createOpenAICompatClient, streamOpenAICompat } from './providers/openaiCompat'
import { streamAnthropic } from './providers/anthropic'

// 副体（二体・三体）の見解をリアルタイムに可視化するため、非ストリーミングではなく
// body_text イベントを逐次送出しながら全文を蓄積して返す
export async function streamSecondaryBody(
  body: BodyConfig,
  bodyIndex: number,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  config: LevelConfig,
  systemPrompt: string,
  res: express.Response,
): Promise<string> {
  const model = resolveBodyModel(body)
  let full = ''

  const emit = (text: string) => {
    full += text
    res.write(`data: ${JSON.stringify({ type: 'body_text', bodyIndex, content: text })}\n\n`)
  }

  if (body.provider === 'anthropic') {
    const anthropicClient = new Anthropic({ apiKey: body.apiKey })
    const anthropicMsgs = toAnthropicMessages(messages)
    const stream = anthropicClient.messages.stream({
      model,
      max_tokens: config.maxTokens,
      messages: anthropicMsgs,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    })
    stream.on('text', (textDelta) => emit(textDelta))
    await stream.finalMessage()
    return full
  }

  if (body.provider === 'ollama') {
    await streamOllamaNative(model, toOllamaMessages(messages, systemPrompt), config.maxTokens, emit)
    return full
  }

  const oaiClient = createOpenAICompatClient(body)
  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : []
  const stream = await oaiClient.chat.completions.create({
    model,
    max_tokens: config.maxTokens,
    messages: [...systemMessages, ...messages],
    stream: true,
  })
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) emit(content)
  }
  return full
}

export async function streamBodyOAI(
  body: BodyConfig,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  config: LevelConfig,
  systemPrompt: string,
  res: express.Response,
): Promise<void> {
  const model = resolveBodyModel(body)

  if (body.provider === 'anthropic') {
    const anthropicClient = new Anthropic({ apiKey: body.apiKey })
    const anthropicMsgs = toAnthropicMessages(messages)
    await streamAnthropic(
      res,
      anthropicMsgs,
      { ...config, anthropicModel: model },
      systemPrompt,
      anthropicClient
    )
    return
  }

  if (body.provider === 'ollama') {
    await streamOllamaNative(model, toOllamaMessages(messages, systemPrompt), config.maxTokens, (content) => {
      res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
    })
    return
  }

  const oaiClient = createOpenAICompatClient(body)
  await streamOpenAICompat(oaiClient, model, res, messages, config.maxTokens, systemPrompt)
}
