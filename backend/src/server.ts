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
  1: { anthropicModel: 'claude-haiku-4-5-20251001', openaiModel: 'gpt-4o-mini',  deepseekModel: 'deepseek-chat',     ollamaModel: 'gemma2:27b', maxTokens: 2048 },
  2: { anthropicModel: 'claude-haiku-4-5-20251001', openaiModel: 'gpt-4o-mini',  deepseekModel: 'deepseek-chat',     ollamaModel: 'gemma2:27b', maxTokens: 4096 },
  3: { anthropicModel: 'claude-sonnet-4-6',         openaiModel: 'gpt-4o',       deepseekModel: 'deepseek-chat',     ollamaModel: 'gemma2:27b', maxTokens: 8192 },
  4: { anthropicModel: 'claude-sonnet-4-6',         openaiModel: 'gpt-4o',       deepseekModel: 'deepseek-reasoner', ollamaModel: 'gemma2:27b', maxTokens: 16000, thinkingBudget: 8000 },
  5: { anthropicModel: 'claude-opus-4-7',           openaiModel: 'o3',           deepseekModel: 'deepseek-reasoner', ollamaModel: 'gemma2:27b', maxTokens: 32000, thinkingBudget: 16000 },
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
    systemPrompt  = "あなたは、駒田隆人によって構築されたAIアシスタントです。**必ず日本語のみで回答すること。中国語・英語・その他の言語は一切使用禁止。**ユーザーの質問に対して、正確かつ簡潔に答えてください。",
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

// ── 青空文庫 ──────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

function cleanAozoraHtml(html: string): { title: string; author: string; text: string } {
  const titleMatch  = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const authorMatch = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
  const title  = titleMatch  ? stripTags(titleMatch[1])  : '不明'
  const author = authorMatch ? stripTags(authorMatch[1]) : '不明'

  // main_text div を抽出（なければ body 全体を使用）
  const mainMatch = html.match(/<div[^>]*class="[^"]*main_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  const mainHtml  = mainMatch ? mainMatch[1] : html

  const deruby = mainHtml
    // <ruby><rb>漢字</rb>...<rt>よみ</rt>...</ruby> → 漢字
    .replace(/<ruby[^>]*>([\s\S]*?)<\/ruby>/gi, (_, inner) => {
      const rb = inner.match(/<rb[^>]*>([\s\S]*?)<\/rb>/i)
      return rb ? rb[1] : stripTags(inner)
    })
    // 漢字《よみ》 表記 → 漢字
    .replace(/([^\s]+?)《[^》]+》/g, '$1')

  const text = deruby
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, '　')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/底本[\s\S]*$/, '')   // 底本情報以降を除去
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title, author, text }
}

app.post('/api/aozora/fetch', async (req, res) => {
  const { url } = req.body as { url: string }
  if (!url || !url.includes('aozora.gr.jp')) {
    res.status(400).json({ error: '青空文庫のURLを指定してください' })
    return
  }

  try {
    const response = await fetch(url)
    if (!response.ok) {
      res.status(502).json({ error: `取得失敗: HTTP ${response.status}` })
      return
    }

    const buffer  = await response.arrayBuffer()
    // charset を判定（utf-8 or shift_jis）
    const preview = new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, 1024))
    const charset = (preview.match(/charset=["']?([\w_-]+)["']?/i)?.[1] ?? 'utf-8').toLowerCase()
    const html    = charset.includes('shift') || charset.replace(/-/g, '') === 'sjis'
      ? new TextDecoder('shift_jis').decode(buffer)
      : new TextDecoder('utf-8').decode(buffer)

    res.json(cleanAozoraHtml(html))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

export type AozoraScene = {
  id:      number
  text:    string
  type:    '情景' | '心情' | '対話'
  summary: string
}

app.post('/api/aozora/split', async (req, res) => {
  const { text, title, author, provider = 'openai' } = req.body as {
    text: string; title: string; author: string; provider?: Provider
  }
  if (!text) { res.status(400).json({ error: 'text が必要です' }); return }

  const excerpt = text.slice(0, 3000)
  // 出力をオブジェクトでラップ（response_format: json_object はroot配列を許可しないため）
  const prompt  = `あなたは日本文学の映像化プロデューサーです。
「${title}」（${author}）のテキストを映像シーンに分割してください。

ルール：
- 1シーンは50〜300文字（自然な文の区切りで切る）
- 各シーンを分類する → 「情景」（風景・描写）／「心情」（内面・感情）／「対話」（セリフ・会話）
- 各シーンの映像イメージを30文字以内で summary に書く
- 最大15シーンに収める
- textフィールド内の改行は\\nとエスケープすること

必ず以下の形式のJSONオブジェクトのみを出力（説明文・コードブロック不要）：
{"scenes":[{"id":1,"text":"...","type":"情景","summary":"..."},...]}

テキスト：
${excerpt}`

  try {
    let rawText: string

    if (provider === 'anthropic') {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const block = message.content[0]
      if (block.type !== 'text') throw new Error('unexpected LLM response type')
      rawText = block.text
    } else {
      const client = provider === 'deepseek' ? deepseek : provider === 'ollama' ? ollama : openai
      const model  = provider === 'deepseek' ? 'deepseek-chat' : provider === 'ollama' ? 'gemma2:27b' : 'gpt-4o-mini'
      const chat   = await client.chat.completions.create({
        model, max_tokens: 4096,
        // json_object モードで強制：LLMが不正なJSONを生成しなくなる
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      })
      rawText = chat.choices[0]?.message?.content ?? ''
    }

    // コードブロックがあれば除去してからパース
    const cleaned = rawText.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    let parsed: { scenes?: AozoraScene[] }
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      // パース失敗時はLLM出力の先頭200文字をエラーに含める（デバッグ用）
      const preview = cleaned.slice(0, 200).replace(/\n/g, '↵')
      throw new Error(`JSON解析失敗: ${(parseErr as Error).message} | LLM出力先頭: ${preview}`)
    }

    const scenes = parsed.scenes ?? []
    res.json({ scenes })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', providers: ['anthropic', 'openai', 'deepseek', 'ollama'] })
})

// ── 顔認証 ────────────────────────────────────────────────────────────────

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0))
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
