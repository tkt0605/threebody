import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const deepseek  = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})
const ollama    = new OpenAI({
  apiKey:  'ollama',
  baseURL: 'http://localhost:11434/v1',
})

type LevelConfig = {
  anthropicModel: string
  openaiModel:    string
  deepseekModel:  string
  ollamaModel:    string
  maxTokens:      number
  thinkingBudget?: number
}

const LEVEL_CONFIG: Record<number, LevelConfig> = {
  1: { anthropicModel: 'claude-haiku-4-5-20251001', openaiModel: 'gpt-4o-mini',  deepseekModel: 'deepseek-chat',     ollamaModel: 'qwen2.5:0.5b', maxTokens: 2048 },
  2: { anthropicModel: 'claude-haiku-4-5-20251001', openaiModel: 'gpt-4o-mini',  deepseekModel: 'deepseek-chat',     ollamaModel: 'qwen2.5:0.5b', maxTokens: 4096 },
  3: { anthropicModel: 'claude-sonnet-4-6',         openaiModel: 'gpt-4o',       deepseekModel: 'deepseek-chat',     ollamaModel: 'qwen2.5:0.5b', maxTokens: 8192 },
  4: { anthropicModel: 'claude-sonnet-4-6',         openaiModel: 'gpt-4o',       deepseekModel: 'deepseek-reasoner', ollamaModel: 'qwen2.5:0.5b', maxTokens: 16000, thinkingBudget: 8000 },
  5: { anthropicModel: 'claude-opus-4-7',           openaiModel: 'o3',           deepseekModel: 'deepseek-reasoner', ollamaModel: 'qwen2.5:0.5b', maxTokens: 32000, thinkingBudget: 16000 },
}

type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'

async function streamAnthropic(
  res: express.Response,
  messages: Anthropic.MessageParam[],
  config: LevelConfig,
  systemPrompt: string,
) {
  const params: Anthropic.MessageCreateParams = {
    model: config.anthropicModel,
    max_tokens: config.maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(config.thinkingBudget
      ? { thinking: { type: 'enabled', budget_tokens: config.thinkingBudget } }
      : {}),
    stream: true,
  }

  const stream = await anthropic.messages.create(params) as AsyncIterable<Anthropic.MessageStreamEvent>

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`)
    }
  }
}

async function streamOpenAICompat(
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

app.post('/api/chat', async (req, res) => {
  const {
    messages,
    thinkingLevel = 3,
    systemPrompt  = 'You are a helpful assistant. Please respond in Japanese.',
    provider      = 'ollama',
  } = req.body as {
    messages:      Anthropic.MessageParam[]
    thinkingLevel: number
    systemPrompt:  string
    provider:      Provider
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const config      = LEVEL_CONFIG[thinkingLevel] ?? LEVEL_CONFIG[3]
  const oaiMessages = messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[]

  try {
    if (provider === 'anthropic') {
      await streamAnthropic(res, messages, config, systemPrompt)
    } else if (provider === 'openai') {
      await streamOpenAICompat(openai, config.openaiModel, res, oaiMessages, config.maxTokens, systemPrompt)
    } else if (provider === 'deepseek') {
      await streamOpenAICompat(deepseek, config.deepseekModel, res, oaiMessages, config.maxTokens, systemPrompt)
    } else {
      await streamOpenAICompat(ollama, config.ollamaModel, res, oaiMessages, config.maxTokens, systemPrompt)
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
  } finally {
    res.end()
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', providers: ['anthropic', 'openai', 'deepseek', 'ollama'] })
})

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`ThreeBody API listening on :${PORT}`)
})
