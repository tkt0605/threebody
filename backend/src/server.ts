import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: new URL('../../.env', import.meta.url).pathname })

// Service role key でRLSをバイパスして顔特徴量を操作する
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const app = express()
app.use(cors({ origin: process.env.VITE_ORIGIN_BASE_URL }))
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
}

function createBodyClient(body: BodyConfig): { client: OpenAI | Anthropic; isAnthropic: boolean } {
  if (body.provider === 'anthropic') {
    return { client: new Anthropic({ apiKey: body.apiKey || process.env.ANTHROPIC_API_KEY }), isAnthropic: true }
  }
  const baseURLs: Record<string, string | undefined> = {
    ollama:   'http://localhost:11434/v1',
    deepseek: 'https://api.deepseek.com',
  }
  const client = new OpenAI({
    apiKey:  body.provider === 'ollama' ? 'ollama' : (body.apiKey || undefined),
    baseURL: baseURLs[body.provider],
  })
  return { client, isAnthropic: false }
}

function resolveBodyModel(body: BodyConfig, config: LevelConfig): string {
  if (body.provider === 'ollama')    return body.model || config.ollamaModel
  if (body.provider === 'openai')    return config.openaiModel
  if (body.provider === 'deepseek')  return config.deepseekModel
  return config.anthropicModel
}

async function getBodyResponse(
  body: BodyConfig,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  config: LevelConfig,
  systemPrompt: string,
): Promise<string> {
  const model = resolveBodyModel(body, config)
  const { client, isAnthropic } = createBodyClient(body)

  if (isAnthropic) {
    const anthropicClient = client as Anthropic
    const anthropicMsgs = messages as unknown as Anthropic.MessageParam[]
    const msg = await anthropicClient.messages.create({
      model,
      max_tokens: config.maxTokens,
      messages: anthropicMsgs,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    })
    const block = msg.content.find(b => b.type === 'text')
    return block?.type === 'text' ? block.text : ''
  }

  const oaiClient = client as OpenAI
  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : []
  const resp = await oaiClient.chat.completions.create({
    model,
    max_tokens: Math.min(config.maxTokens, 2048),
    messages: [...systemMessages, ...messages],
    stream: false,
  })
  return resp.choices[0]?.message?.content ?? ''
}

async function streamBodyOAI(
  body: BodyConfig,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  config: LevelConfig,
  systemPrompt: string,
  res: express.Response,
): Promise<void> {
  const model = resolveBodyModel(body, config)
  const { client, isAnthropic } = createBodyClient(body)

  if (isAnthropic) {
    const anthropicClient = client as Anthropic
    const anthropicMsgs = messages as unknown as Anthropic.MessageParam[]
    await streamAnthropic(res, anthropicMsgs, { ...config, anthropicModel: model }, systemPrompt)
    return
  }

  const oaiClient = client as OpenAI
  await streamOpenAICompat(oaiClient, model, res, messages, config.maxTokens, systemPrompt)
}

async function streamAnthropic(
  res: express.Response,
  messages: Anthropic.MessageParam[],
  config: LevelConfig,
  systemPrompt: string,
) {
  // Opus 4.7: budget_tokens は削除済み → adaptive thinking を使う
  // Sonnet 4.6 以下: thinkingBudget があれば enabled（非推奨だが機能する）
  const thinkingParam = config.adaptiveThinking
    ? { thinking: { type: 'adaptive' as const } }
    : config.thinkingBudget
      ? { thinking: { type: 'enabled' as const, budget_tokens: config.thinkingBudget } }
      : {}

  // messages.stream() を使う（create({ stream: true }) より型安全で取り扱いが容易）
  const stream = anthropic.messages.stream({
    model:      config.anthropicModel,
    max_tokens: config.maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...thinkingParam,
  })

  // textStream は thinking ブロックを自動的にスキップしてテキストのみ流す
  for await (const text of stream.textStream) {
    res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`)
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
    systemPrompt  = "あなたは、駒田隆人によって開発された高度なAIアシスタントです。ユーザーの質問に対して、正確かつ簡潔な回答を提供してください。必要に応じて、コード例や具体的な手順を示すこともできます。",
    provider      = 'ollama',
    bodies,
  } = req.body as {
    messages:      Anthropic.MessageParam[]
    thinkingLevel: number
    systemPrompt:  string
    provider:      Provider
    bodies?:       BodyConfig[]
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const config      = (LEVEL_CONFIG[thinkingLevel] ?? LEVEL_CONFIG[3])!
  const oaiMessages = messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[]

  try {
    // ── 三体モード ─────────────────────────────────────────────────────────────
    if (bodies && Array.isArray(bodies) && bodies.length > 0) {
      const available = bodies.filter(b =>
        b.provider === 'ollama' || (b.apiKey && b.apiKey.trim().length > 0)
      )

      if (available.length > 1) {
        // 副体（二体・三体）からの見解を並列取得
        const [primary, ...secondaries] = available as [BodyConfig, ...BodyConfig[]]
        const secondaryResponses = await Promise.all(
          secondaries.map(b => getBodyResponse(b, oaiMessages, config, systemPrompt))
        )

        const BODY_NAMES = ['一体', '二体', '三体']
        const perspectives = secondaryResponses
          .filter(r => r.trim())
          .map((r, i) => {
            const bodyIdx = bodies.indexOf(secondaries[i]!)
            return `【${BODY_NAMES[bodyIdx] ?? '副体'}（${secondaries[i]!.provider}）の見解】\n${r}`
          })
          .join('\n\n')

        const synthesisSystemPrompt = systemPrompt
          + '\n\n以下は他の体（LLM）の見解です。これらを踏まえて、より包括的かつ統合的な最終回答を生成してください。'

        const lastUserMsg = oaiMessages[oaiMessages.length - 1]
        const synthesisMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          ...oaiMessages.slice(0, -1),
          {
            role: 'user',
            content: `${lastUserMsg?.content ?? ''}\n\n---\n${perspectives}`,
          },
        ]

        await streamBodyOAI(primary, synthesisMessages, config, synthesisSystemPrompt, res)
        res.write('data: [DONE]\n\n')
        return
      }

      if (available.length === 1) {
        await streamBodyOAI(available[0]!, oaiMessages, config, systemPrompt, res)
        res.write('data: [DONE]\n\n')
        return
      }
    }

    // ── 単体モード（従来） ───────────────────────────────────────────────────────
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

// ── 顔認証 ────────────────────────────────────────────────────────────────

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - (b[i] ?? 0)) ** 2, 0))
}

// 顔特徴量を登録（サインアップ時）
app.post('/api/auth/face/register', async (req, res) => {
  const { email, descriptor } = req.body as { email: string; descriptor: number[] }
  if (!email || !Array.isArray(descriptor)) {
    res.status(400).json({ error: 'email と descriptor が必要です' }); return
  }

  const { error } = await supabaseAdmin
    .from('face_descriptors')
    .upsert({ email, descriptor, user_id: null }, { onConflict: 'email' })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// 顔特徴量を照合（ログイン時）
app.post('/api/auth/face/verify', async (req, res) => {
  const { email, descriptor } = req.body as { email: string; descriptor: number[] }
  if (!email || !Array.isArray(descriptor)) {
    res.status(400).json({ error: 'email と descriptor が必要です' }); return
  }

  const { data, error } = await supabaseAdmin
    .from('face_descriptors')
    .select('descriptor')
    .eq('email', email)
    .single()

  if (error || !data) {
    res.status(404).json({ error: '顔データが見つかりません。先にサインアップしてください。' }); return
  }

  const stored: number[] = data.descriptor
  const distance = euclidean(descriptor, stored)
  res.json({ match: distance < 0.6, distance })
})

// user_id を顔特徴量に紐付け（サインアップOTP確認後）
app.post('/api/auth/face/link', async (req, res) => {
  const { email, userId } = req.body as { email: string; userId: string }
  if (!email || !userId) { res.status(400).json({ error: 'email と userId が必要です' }); return }

  const { error } = await supabaseAdmin
    .from('face_descriptors')
    .update({ user_id: userId })
    .eq('email', email)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// 顔認証ログイン：照合成功時にセッショントークンを返す
app.post('/api/auth/face/login', async (req, res) => {
  const { email, descriptor } = req.body as { email: string; descriptor: number[] }
  if (!email || !Array.isArray(descriptor)) {
    res.status(400).json({ error: 'email と descriptor が必要です' }); return
  }

  const { data, error } = await supabaseAdmin
    .from('face_descriptors')
    .select('descriptor')
    .eq('email', email)
    .single()

  if (error || !data) {
    res.status(404).json({ error: '顔データが見つかりません。先にサインアップしてください。' }); return
  }

  const distance = euclidean(descriptor, data.descriptor as number[])
  if (distance >= 0.6) {
    res.status(401).json({ error: '顔が一致しません。登録した顔で再試行してください。' }); return
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !linkData) {
    res.status(500).json({ error: linkError?.message ?? 'セッション生成に失敗しました' }); return
  }

  res.json({ token_hash: linkData.properties.hashed_token })
})

// 顔認証サインアップ：ユーザー作成 + 顔登録 + セッショントークンを返す
app.post('/api/auth/face/signup', async (req, res) => {
  const { email, descriptor } = req.body as { email: string; descriptor: number[] }
  if (!email || !Array.isArray(descriptor)) {
    res.status(400).json({ error: 'email と descriptor が必要です' }); return
  }

  // ユーザー作成を試みる。既存の場合はメール検索で補完
  let userId: string

  const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  })

  if (createError) {
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers()
    if (listError) { res.status(500).json({ error: listError.message }); return }

    const existing = listData.users.find(u => u.email === email)
    if (!existing) {
      // 既存ユーザーでもない → DBトリガー等の本物のエラー
      console.error('[signup] createUser error:', createError)
      res.status(400).json({
        error: `ユーザー作成エラー: ${createError.message}`,
        hint: 'Supabase Dashboard → Database → Triggers でトリガーを確認してください',
      }); return
    }
    userId = existing.id
  } else {
    userId = userData.user.id
  }

  const { error: faceError } = await supabaseAdmin
    .from('face_descriptors')
    .upsert({ email, descriptor, user_id: userId }, { onConflict: 'email' })

  if (faceError) {
    res.status(500).json({ error: faceError.message }); return
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !linkData) {
    res.status(500).json({ error: linkError?.message ?? 'セッション生成に失敗しました' }); return
  }

  res.json({ token_hash: linkData.properties.hashed_token })
})

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`ThreeBody API listening on :${PORT}`)
})
