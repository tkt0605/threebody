import type express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BodyConfig, LevelConfig } from './types'
import { resolveBodyModel, toOllamaMessages, toAnthropicMessages, extractTextContent } from './messageHelpers'
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
    const finalMsg = await stream.finalMessage()
    console.info(`[usage] secondary bodyIndex=${bodyIndex} model=${model}`, finalMsg.usage)
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

// 副体（二体・三体）を並列取得 → 見解をシステムプロンプトに注入 → 主体が統合回答をストリーミング、
// という三体モードの一連の流れ。`allBodies` は SSE の bodyIndex を求めるための元配列
// （通常モードでは req.body.bodies、共有キーモードでは available と同一の配列）
export async function orchestrateMultiBody(
  allBodies: BodyConfig[],
  available: BodyConfig[],
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  config: LevelConfig,
  systemPrompt: string,
  res: express.Response,
): Promise<void> {
  const [primary, ...secondaries] = available as [BodyConfig, ...BodyConfig[]]

  const secondaryResults = await Promise.all(
    secondaries.map(async (b) => {
      const bodyIdx = allBodies.indexOf(b)
      const name    = b.name ?? '副体'
      res.write(`data: ${JSON.stringify({ type: 'body_start', bodyIndex: bodyIdx, name, provider: b.provider })}\n\n`)
      const text = await streamSecondaryBody(b, bodyIdx, messages, { ...config, maxTokens: config.secondaryMaxTokens }, b.personaPrompt ?? systemPrompt, res)
      res.write(`data: ${JSON.stringify({ type: 'body_done', bodyIndex: bodyIdx })}\n\n`)
      return { name, provider: b.provider, text }
    })
  )

  const perspectives = secondaryResults
    .map(({ name, provider, text }) => {
      if (!text.trim()) return null
      return `【${name}（${provider}）の見解】\n${text}`
    })
    .filter(Boolean)
    .join('\n\n')

  const synthesisSystemPrompt = systemPrompt
    + '\n\n以下は他の体（LLM）の見解です。これらを踏まえて、より包括的かつ統合的な最終回答を生成してください。'

  const lastUserMsg = messages[messages.length - 1]
  const synthesisMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...messages.slice(0, -1),
    {
      role: 'user',
      content: `${extractTextContent(lastUserMsg?.content)}\n\n---\n${perspectives}`,
    },
  ]

  res.write(`data: ${JSON.stringify({ type: 'synthesis_start', bodyIndex: allBodies.indexOf(primary) })}\n\n`)
  await streamBodyOAI(primary, synthesisMessages, config, synthesisSystemPrompt, res)
}
