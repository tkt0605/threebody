import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { BodyConfig, Provider } from '../llm/types'
import { M, LEVEL_CONFIG } from '../llm/modelConfig'
import { toOllamaMessages } from '../llm/messageHelpers'
import { streamBodyOAI, orchestrateMultiBody } from '../llm/textService'
import { streamAnthropic } from '../llm/providers/anthropic'
import { streamOpenAICompat } from '../llm/providers/openaiCompat'
import { streamOllamaNative } from '../llm/providers/ollama'
import { collectSecrets, sanitizeErrorMessage } from '../utils/errorSanitize'
import { resolveUserId } from '../auth'
import {
  SHARED_DAILY_LIMIT, SHARED_THINKING_LEVEL,
  sharedApiKey, hasOwnCloudKey, checkSharedAllowance, consumeSharedQuota,
} from '../sharedKey'

const router = Router()

// /api/chat は curl等フロントを介さない生のリクエストでも叩ける（CORSはブラウザだけの制約のため）。
// IPあたりの機械的な連打だけを弾く粗い防波堤。ユーザー単位にすると resolveUserId の
// Supabase問い合わせが二重になるため、あえてIP単位に留める
const chatRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit:    15,
  standardHeaders: true,
  legacyHeaders:   false,
})

router.post('/chat', chatRateLimit, async (req, res) => {
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
          // ThreeBodyの名を冠する以上、無料枠でも三体モードを見せる（Phase 0）。
          // プロバイダーはAnthropicのみに揃え、新規シークレットへの依存を避ける
          // （混成プロバイダー化は将来の拡張として温存）。同一モデル3体では見解が
          // 収束しすぎるため、副体にはpersonaPromptで視点の差を持たせる
          const sharedBodies: BodyConfig[] = [
            { provider: 'anthropic', apiKey: key, model: sharedConfig.anthropicModel, name: '一体' },
            {
              provider: 'anthropic', apiKey: key, model: sharedConfig.anthropicModel, name: '二体',
              personaPrompt: systemPrompt + '\n\n慎重派の視点で、リスクや見落としがちな懸念点を重視して答えてください。',
            },
            {
              provider: 'anthropic', apiKey: key, model: sharedConfig.anthropicModel, name: '三体',
              personaPrompt: systemPrompt + '\n\n発想派の視点で、別の角度からのアイデアや可能性を重視して答えてください。',
            },
          ]
          await orchestrateMultiBody(sharedBodies, sharedBodies, oaiMessages, sharedConfig, systemPrompt, res)
          completed = true
          res.write('data: [DONE]\n\n')
          return
        }
      } else if (allowance.reason !== 'limit_reached') {
        // ここが無言だと「キー未設定なのに共有キーが動かない」の切り分けができない。
        // unavailable=環境変数かSupabase未設定 / not_signed_in=トークン無し
        // / not_permitted=can_use_shared_key が false か行が無い
        console.info(`[sharedKey] 使用せず: ${allowance.reason}`)
      } else {
        // 既存のerrorイベント形式に乗せる。フロントはこれをそのまま描画できる
        // code: 'limit_reached' はバグではなく仕様どおりの制限なので、フロント側で
        // 「問題を報告する」ボタン（本物のエラー用UI）を出さないための判別に使う
        res.write(`data: ${JSON.stringify({
          type:    'error',
          code:    'limit_reached',
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
        // 副体（二体・三体）からの見解を並列取得 → 主体が統合、という一連の流れは
        // orchestrateMultiBody に集約（共有キー経路の三体モードとも共有）
        await orchestrateMultiBody(bodies, available, oaiMessages, config, systemPrompt, res)
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

export default router
