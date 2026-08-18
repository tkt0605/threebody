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
import { streamOllamaNative, ollamaEnabled } from '../llm/providers/ollama'
import { collectSecrets, sanitizeErrorMessage } from '../utils/errorSanitize'
import { resolveUserId } from '../auth'
import {
  SHARED_DAILY_LIMIT, SHARED_THINKING_LEVEL,
  sharedApiKey, hasOwnCloudKey, reserveSharedAllowance, consumeSharedQuota, releaseGlobalQuota,
} from '../sharedKey'

const router = Router()

// 副体に具体物を書かせないための指示。
//
// 自前キー経路では同じ内容がフロントの src/constants/bodyPersonas.ts (NO_ARTIFACT) から
// personaPrompt に載って届くが、共有キー経路の personaPrompt はここで組み立てるため
// 素通しになっていた（実測: DEBUG_SYNTHESIS のログで「書くな」指示=未到達）。
// 共有キーは運営がトークンを負担する経路なので、副体2体に長い具体物を書かせる余地を
// 残しておく理由がない。
//
// フロントと共有せず同じ文面を2箇所に持つのは、backend が src/ を参照しないため。
// 片方だけ直すと「自前キーでは守るのに共有キーでは書く」というズレに戻るので、
// 変更するときは必ず両方を揃えること
const SECONDARY_NO_ARTIFACT = `
コードや具体的な実装そのものは書かない。
「どういう方針で作るべきか」「何に注意すべきか」を3〜5行で述べるに留める。
具体物を作るのは統合役の仕事。`

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
    // 未指定なら true。curl 等の生リクエストや古いフロントの挙動を変えないため
    useSharedKey  = true,
  } = req.body as {
    messages:      Anthropic.MessageParam[]
    thinkingLevel: number
    systemPrompt:  string
    provider:      Provider
    bodies?:       BodyConfig[]
    model?:        string
    apiKey?:       string
    useSharedKey?: boolean
  }

  // 認証は必須。トークンが無い・検証に失敗したリクエストはここで終わる。
  //
  // 【必須にした理由】以前は null を許して「自分のAPIキーを持つユーザーは未ログインでも
  // 使える」設計だったが、それはこのサーバーを誰でもLLMプロキシとして踏み台にできる
  // ということでもあった。運営のコストは増えない（共有キー経路は元から userId 必須）が、
  // 帯域とプロセスがただ乗りされ、無料プランでは可用性に直結する。
  // フロントは router の requiresAuth で全画面ログイン必須なので、実質的な後退は無い。
  //
  // 【順序が重要】SSEヘッダを flush した後では 401 を返せない（ステータスは送信済みに
  // なる）。認証判定は必ずヘッダ送出より前に置くこと
  const userId = await resolveUserId(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'ログインが必要です。' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const config      = (LEVEL_CONFIG[thinkingLevel] ?? LEVEL_CONFIG[3])!
  const oaiMessages = messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[]

  // 共有キーを使ったか / 応答が正常完了したか。
  // カウントを増やしてよいのは両方 true のときだけ（判定は finally）
  let sharedKeyUsed = false
  let completed     = false
  // 全体枠を1つ予約したか。予約は応答を始める前に取るので、提供できずに終わった場合は
  // finally で返す必要がある（返さないと、失敗するたびにキルスイッチが目減りする）
  let globalReserved = false

  try {
    // ── 共有キーへのフォールバック ─────────────────────────────────────────────
    // 自分のクラウド系キーを1つも設定していないユーザーだけがここに入る。
    //
    // useSharedKey が false のときはこのブロックごと飛ばす。予約（reserveSharedAllowance）
    // にも触れないので、OFF にしている間は無料枠が1回も減らない。そのまま下の
    // 三体モード / 単体モードへ抜け、ユーザーの bodies 設定（＝Ollama）が使われる
    if (useSharedKey && !hasOwnCloudKey({ bodies, provider, apiKey, model })) {
      // 実際にLLMを呼ぶ経路なので、判定と同時に全体枠を1つ予約する側を呼ぶ
      const allowance = await reserveSharedAllowance(userId)

      if (allowance.allowed) {
        // この時点で全体枠を1つ取っている。以降どの経路で抜けても、
        // [DONE] に到達しなければ finally で返す
        globalReserved = true

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
              personaPrompt: systemPrompt
                + '\n\n慎重派の視点で、リスクや見落としがちな懸念点を重視して答えてください。'
                + SECONDARY_NO_ARTIFACT,
            },
            {
              provider: 'anthropic', apiKey: key, model: sharedConfig.anthropicModel, name: '三体',
              personaPrompt: systemPrompt
                + '\n\n発想派の視点で、別の角度からのアイデアや可能性を重視して答えてください。'
                + SECONDARY_NO_ARTIFACT,
            },
          ]
          await orchestrateMultiBody(sharedBodies, sharedBodies, oaiMessages, sharedConfig, systemPrompt, res)
          completed = true
          res.write('data: [DONE]\n\n')
          return
        }
      } else if (
        (allowance.reason === 'limit_reached' || allowance.reason === 'global_limit_reached')
        // Ollamaが使えるなら上限到達はエラーではなく、ただの経路の切り替えでしかない。
        // ここで return すると下の三体モード（bodies）・単体モードへ落ちられず、
        // ローカルLLMを持っているユーザーまで「今日はもう使えません」で止まる
        && !(ollamaEnabled() && (bodies ?? []).some(b => b.provider === 'ollama'))
      ) {
        // 既存のerrorイベント形式に乗せる。フロントはこれをそのまま描画できる。
        // code はバグではなく仕様どおりの制限であることの印で、フロント側は
        // 「問題を報告する」ボタン（本物のエラー用UI）を出さない判別に使う。
        //
        // 個人枠と全体枠で文言を必ず分ける。全体枠で弾かれたユーザーは今日まだ1回も
        // 使っていないことがあり、そこへ「今日の無料利用は3回までです」と出すと
        // 「使っていないのに使い切った」と言われたことになる
        res.write(`data: ${JSON.stringify({
          type:    'error',
          code:    allowance.reason,
          message: allowance.reason === 'limit_reached'
            ? `今日の無料利用は${SHARED_DAILY_LIMIT}回までです。設定から自分のAPIキーを登録すると続けて使えます。`
            : '本日ぶんの無料お試し枠（全体）が終了しました。明日また使えます。今すぐ続けるなら設定から自分のAPIキーを登録してください。',
        })}\n\n`)
        return
      }
      // unavailable / not_signed_in / not_permitted は従来どおりの処理へ落ちる。
      // 判定の内訳（誰が・なぜ弾かれたか）は peekSharedAllowance 側でログに出している
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
    // 「共有キーで応答を提供できた」＝ 個人枠を数えてよく、全体枠も返さない唯一の状態。
    // finally で「無条件に」消費すると catch 経由のエラー時にも加算されて要件と逆になるため
    // completed を見るが、完了しても共有キーを使っていない経路（予約後にキーが読めず
    // Ollama へ落ちた等）があるので、completed だけでも足りない
    const sharedKeyServed = sharedKeyUsed && completed

    if (sharedKeyServed && userId) {
      await consumeSharedQuota(userId)
    }
    // 予約したのに提供できなかったぶんは全体枠へ返す。
    // 個人枠が「提供できたときだけ加算」なのと表裏の関係になっている
    if (globalReserved && !sharedKeyServed) {
      await releaseGlobalQuota()
    }
    res.end()
  }
})

export default router
