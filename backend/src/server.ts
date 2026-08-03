import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import dotenv from 'dotenv'
import { collectSecrets, sanitizeErrorMessage } from './errorSanitize'
import { resolveUserId } from './auth'
import {
  SHARED_DAILY_LIMIT, SHARED_THINKING_LEVEL,
  sharedApiKey, hasOwnCloudKey, checkSharedAllowance, consumeSharedQuota,
} from './sharedKey'

dotenv.config({ path: new URL('../../.env', import.meta.url).pathname })

const app = express()
app.use(cors({ origin: process.env.VITE_ORIGIN_BASE_URL }))
app.use(express.json())

// OpenAI互換の /v1/chat/completions は think:false を無視し、reasoning搭載モデルは
// 内部思考をそのまま流し続ける（content は空のまま）。ネイティブ /api/chat だけが
// think:false を尊重するため、Ollamaはこちらを直接叩く。
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

// 運営側のキーで動くクライアント。streamAnthropic の client 既定値として使う
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type LevelConfig = {
  anthropicModel:    string
  openaiModel:       string
  deepseekModel:     string
  ollamaModel:       string
  maxTokens:         number
  thinkingBudget?:   number  // Sonnet 4.6 以下で使用（deprecated だが機能はする）
  adaptiveThinking?: boolean // Opus 4.7 専用（budget_tokens は 400 になるため）
}

const M = {
  anthropic: {
    fast:     process.env.ANTHROPIC_MODEL_FAST!,
    balanced: process.env.ANTHROPIC_MODEL_BALANCED!,
    powerful: process.env.ANTHROPIC_MODEL_POWERFUL!,
  },
  openai: {
    fast:     process.env.OPENAI_MODEL_FAST!,
    balanced: process.env.OPENAI_MODEL_BALANCED!,
    powerful: process.env.OPENAI_MODEL_POWERFUL!,
  },
  deepseek: {
    fast:     process.env.DEEPSEEK_MODEL_FAST!,
    powerful: process.env.DEEPSEEK_MODEL_POWERFUL!,
  },
  ollama: {
    default:  process.env.OLLAMA_MODEL_DEFAULT!,
  },
}

const LEVEL_CONFIG: Record<number, LevelConfig> = {
  1: { anthropicModel: M.anthropic.fast,     openaiModel: M.openai.fast,     deepseekModel: M.deepseek.fast,     ollamaModel: M.ollama.default, maxTokens: 2048 },
  2: { anthropicModel: M.anthropic.fast,     openaiModel: M.openai.fast,     deepseekModel: M.deepseek.fast,     ollamaModel: M.ollama.default, maxTokens: 4096 },
  3: { anthropicModel: M.anthropic.balanced, openaiModel: M.openai.balanced, deepseekModel: M.deepseek.fast,     ollamaModel: M.ollama.default, maxTokens: 8192 },
  4: { anthropicModel: M.anthropic.balanced, openaiModel: M.openai.balanced, deepseekModel: M.deepseek.powerful, ollamaModel: M.ollama.default, maxTokens: 16000, thinkingBudget: 8000 },
  5: { anthropicModel: M.anthropic.powerful, openaiModel: M.openai.powerful, deepseekModel: M.deepseek.powerful, ollamaModel: M.ollama.default, maxTokens: 32000, adaptiveThinking: true },
}

type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'

type BodyProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek'

interface BodyConfig {
  provider: BodyProvider
  apiKey:   string
  model:    string
  name?: string
  personaPrompt?: string
}

// openai/deepseek専用。Ollamaはネイティブ /api/chat を直接叩くためここは通らない
function createOpenAICompatClient(body: BodyConfig): OpenAI {
  const baseURLs: Record<string, string | undefined> = {
    deepseek: 'https://api.deepseek.com',
  }
  return new OpenAI({ apiKey: body.apiKey, baseURL: baseURLs[body.provider] })
}

function resolveBodyModel(body: BodyConfig): string {
  // Ollamaはモデル未指定でもサーバー既定モデルで動く（キー無しの一体モードを最短で成立させる）
  if (body.provider === 'ollama' && !body.model?.trim()) return M.ollama.default
  return body.model
}

// Ollamaのreasoning搭載モデル（gemma4のthinking版等）はOpenAI互換エンドポイントだと
// think:false が効かず、内部思考を reasoning フィールドに流し続け content が空になる。
// ネイティブ /api/chat なら think:false が効き、内部思考を生成させずに済む。
// 一部モデル・量子化ではstopトークンとして正しく扱われず、素のテキストとして
// 出力に混じることがある（例: sarashina2.2系が末尾に </s> を出す）
const OLLAMA_SPECIAL_TOKENS = new Set(['</s>', '<|endoftext|>', '<|im_end|>', '<|eot_id|>', '<end_of_turn>'])

async function streamOllamaNative(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  onContent: (text: string) => void,
): Promise<void> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      think:   false,
      stream:  true,
      options: { num_predict: maxTokens },
    }),
  })
  // if (!response.ok || !response.body) {
  //   const detail = await response.text().catch(() => '')
  //   throw new Error(`Ollama request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
  // }
  if (!response.ok || !response.body) {
    // 本文はプロバイダーが何を返すか制御できない。診断に足りる長さだけ残して切り詰める
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
  }

  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { message?: { content?: string } }
      const content = chunk.message?.content
      if (content && !OLLAMA_SPECIAL_TOKENS.has(content.trim())) onContent(content)
    }
  }
}

function toOllamaMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
): { role: string; content: string }[] {
  const base = messages.map(m => ({ role: m.role, content: extractTextContent(m.content) }))
  return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...base] : base
}

function toAnthropicMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Anthropic.MessageParam[]{
  return messages
    .filter((m): m is OpenAI.Chat.ChatCompletionUserMessageParam | OpenAI.Chat.ChatCompletionAssistantMessageParam =>
      m.role === 'user' || m.role === 'assistant'
    )
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
            .filter((p): p is { type: 'text'; text: string} => p.type === 'text')
            .map(p => p.text)
            .join('')
          : '',
    }))
}

function extractTextContent(
  content: OpenAI.Chat.ChatCompletionMessageParam['content']
): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('')
  return ''
}

// 副体（二体・三体）の見解をリアルタイムに可視化するため、非ストリーミングではなく
// body_text イベントを逐次送出しながら全文を蓄積して返す
async function streamSecondaryBody(
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
    await streamOllamaNative(model, toOllamaMessages(messages, systemPrompt), Math.min(config.maxTokens, 2048), emit)
    return full
  }

  const oaiClient = createOpenAICompatClient(body)
  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : []
  const stream = await oaiClient.chat.completions.create({
    model,
    max_tokens: Math.min(config.maxTokens, 2048),
    messages: [...systemMessages, ...messages],
    stream: true,
  })
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) emit(content)
  }
  return full
}

async function streamBodyOAI(
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

async function streamAnthropic(
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
    systemPrompt  = "あなたは、tkt0605によって開発された高度なAIアシスタントです。ユーザーの質問に対して、正確かつ簡潔な回答を提供してください。必要に応じて、コード例や具体的な手順を示すこともできます。",
    provider      = 'ollama',
    bodies,
    model,
    apiKey,
  } = req.body as {
    messages:      Anthropic.MessageParam[]
    thinkingLevel: number
    systemPrompt:  string
    provider:      Provider
    bodies?:       BodyConfig[]
    model?:        string
    apiKey?:       string
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // 共有APIキーの割当判定にのみ使う。トークンが無い・検証に失敗した場合は null になり、
  // 従来どおり（ユーザー自身のキーで）動く。認証は必須にしない
  const userId = await resolveUserId(req.headers.authorization)

  const config      = (LEVEL_CONFIG[thinkingLevel] ?? LEVEL_CONFIG[3])!
  const oaiMessages = messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[]

  // 共有キーを使ったか / 応答が正常完了したか。
  // カウントを増やしてよいのは両方 true のときだけ（判定は finally）
  let sharedKeyUsed = false
  let completed     = false

  try {
    // ── 共有キーへのフォールバック ─────────────────────────────────────────────
    // 自分のクラウド系キーを1つも設定していないユーザーだけがここに入る
    if (!hasOwnCloudKey({ bodies, provider, apiKey, model })) {
      const allowance = await checkSharedAllowance(userId)

      if (allowance.allowed) {
        // allowed を返した時点で共有キーは存在するが、型の上では null を排除できない
        const key = sharedApiKey()
        if (key) {
          sharedKeyUsed = true
          // 思考レベルはユーザーの指定ではなく固定値を使う。
          // 他人のトークンを運営が負担するため、ここがコスト上限の主レバーになる
          const sharedConfig = LEVEL_CONFIG[SHARED_THINKING_LEVEL]!
          await streamBodyOAI(
            { provider: 'anthropic', apiKey: key, model: sharedConfig.anthropicModel },
            oaiMessages,
            sharedConfig,
            systemPrompt,
            res,
          )
          completed = true
          res.write('data: [DONE]\n\n')
          return
        }
      } else if (allowance.reason === 'limit_reached') {
        // 既存のerrorイベント形式に乗せる。フロントはこれをそのまま描画できる
        res.write(`data: ${JSON.stringify({
          type:    'error',
          message: `今日の無料利用は${SHARED_DAILY_LIMIT}回までです。設定から自分のAPIキーを登録すると続けて使えます。`,
        })}\n\n`)
        return
      }
      // unavailable / not_signed_in / not_permitted は従来どおりの処理へ落ちる
    }

    // ── 三体モード ─────────────────────────────────────────────────────────────
    if (bodies && Array.isArray(bodies) && bodies.length > 0) {
      // Ollamaはキー・モデル未指定でも既定モデルで利用可能（任意のアップグレードとしてクラウドを足す）。
      // クラウド系はAPIキーとモデルの両方が揃って初めて利用可能とみなす。
      const available = bodies.filter(b =>
        b.provider === 'ollama'
          ? true
          : b.apiKey?.trim().length > 0 && b.model?.trim().length > 0
      )

      if (available.length > 1) {
        // 副体（二体・三体）からの見解を並列取得。完了ごとに body_start/body_done を通知し、
        // フロントで「どの体がまだ話しているか」をリアルタイムに可視化できるようにする
        const [primary, ...secondaries] = available as [BodyConfig, ...BodyConfig[]]

        const secondaryResults = await Promise.all(
          secondaries.map(async (b) => {
            const bodyIdx = bodies.indexOf(b)
            const name    = b.name ?? '副体'
            res.write(`data: ${JSON.stringify({ type: 'body_start', bodyIndex: bodyIdx, name, provider: b.provider })}\n\n`)
            const text = await streamSecondaryBody(b, bodyIdx, oaiMessages, {...config, maxTokens: 512},b.personaPrompt ?? systemPrompt, res)
            res.write(`data: ${JSON.stringify({ type: 'body_done', bodyIndex: bodyIdx })}\n\n`)
            return { bodyIdx, name, provider: b.provider, text }
          })
        )

        const perspectives = secondaryResults
          .map(({ bodyIdx, name, provider, text }) => {
            if (!text.trim()) return null
            return `【${name}（${provider}）の見解】\n${text}`
          })
          .filter(Boolean)
          .join('\n\n')

        const synthesisSystemPrompt = systemPrompt
          + '\n\n以下は他の体（LLM）の見解です。これらを踏まえて、より包括的かつ統合的な最終回答を生成してください。'

        const lastUserMsg = oaiMessages[oaiMessages.length - 1]
        const synthesisMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          ...oaiMessages.slice(0, -1),
          {
            role: 'user',
            content: `${extractTextContent(lastUserMsg?.content)}\n\n---\n${perspectives}`,
          },
        ]

        res.write(`data: ${JSON.stringify({ type: 'synthesis_start', bodyIndex: bodies.indexOf(primary) })}\n\n`)
        await streamBodyOAI(primary, synthesisMessages, config, synthesisSystemPrompt, res)
        completed = true
        res.write('data: [DONE]\n\n')
        return
      }

      if (available.length === 1) {
        await streamBodyOAI(available[0]!, oaiMessages, config, systemPrompt, res)
        completed = true
        res.write('data: [DONE]\n\n')
        return
      }
    }

    // ── 単体モード（従来） ───────────────────────────────────────────────────────
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey })
      await streamAnthropic(res, messages, config, systemPrompt, client)
    } else if (provider === 'openai') {
      const client = new OpenAI({ apiKey })
      await streamOpenAICompat(client, model ?? '', res, oaiMessages, config.maxTokens, systemPrompt)
    } else if (provider === 'deepseek') {
      const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })
      await streamOpenAICompat(client, model ?? '', res, oaiMessages, config.maxTokens, systemPrompt)
    } else {
      const ollamaModel = model?.trim() || M.ollama.default
      await streamOllamaNative(ollamaModel, toOllamaMessages(oaiMessages, systemPrompt), config.maxTokens, (content) => {
        res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
      })
    }
    completed = true
    res.write('data: [DONE]\n\n')
  } catch (err) {
    // プロバイダーは認証エラー時に受け取ったキーをエラー本文へ echo back することがある。
    // ここを素通しにすると、共有キーがそのまま全ユーザーのブラウザに届く
    const message = sanitizeErrorMessage(err, collectSecrets({ bodies, apiKey }))
    // err をオブジェクトごと出すと、SDKの例外が保持するリクエストヘッダ（x-api-key 等）まで
    // Renderのログに残る。伏せ字化済みのメッセージだけを出す
    console.error('[/api/chat]', message)
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
  } finally {
    // finally で「無条件に」消費すると、catch を通ったエラー時にも加算されて要件と逆になる。
    // 増やしてよいのは共有キーを使い、かつ [DONE] まで到達したときだけ。
    // completed の判定が入っているため、この位置でも catch 経由では発火しない
    if (sharedKeyUsed && completed && userId) {
      await consumeSharedQuota(userId)
    }
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