import type express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BodyConfig, LevelConfig } from './types'
import { resolveBodyModel, toOllamaMessages, toAnthropicMessages, extractTextContent } from './messageHelpers'
import {
  buildReviewMessages, buildReviewSystemPrompt, hasReviewFinding, needsMultiBody,
  resolveSecondaryRole, reviewRoleLabel,
} from './secondaryPrompt'
import { streamOllamaNative } from './providers/ollama'
import { createOpenAICompatClient, streamOpenAICompat } from './providers/openaiCompat'
import { streamAnthropic } from './providers/anthropic'
import { collectSecrets, sanitizeErrorMessage } from '../utils/errorSanitize'

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

// 主体の本文をSSEへ流しつつ、全文を戻り値でも返す。
// 戻り値が要るのは、副体がこの答えを読んで検算するため。res へ書くだけでは
// 書いた内容が呼び出し側に残らない（プロバイダー3種とも res 直書きだった）
export async function streamBodyOAI(
  body: BodyConfig,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  config: LevelConfig,
  systemPrompt: string,
  res: express.Response,
): Promise<string> {
  const model = resolveBodyModel(body)

  if (body.provider === 'anthropic') {
    const anthropicClient = new Anthropic({ apiKey: body.apiKey })
    const anthropicMsgs = toAnthropicMessages(messages)
    return await streamAnthropic(
      res,
      anthropicMsgs,
      { ...config, anthropicModel: model },
      systemPrompt,
      anthropicClient
    )
  }

  if (body.provider === 'ollama') {
    let full = ''
    await streamOllamaNative(model, toOllamaMessages(messages, systemPrompt), config.maxTokens, (content) => {
      full += content
      res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
    })
    return full
  }

  const oaiClient = createOpenAICompatClient(body)
  return await streamOpenAICompat(oaiClient, model, res, messages, config.maxTokens, systemPrompt)
}

// 検算の対象になる問い。副体には履歴を渡さないので、直近のユーザー発言だけを取り出す
function lastUserText(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  const i = messages.map(m => m.role).lastIndexOf('user')
  return i === -1 ? '' : extractTextContent(messages[i]!.content).trim()
}

// 検算に回すには短すぎる答え。「おはよう。」に崩れる点は無い。
// needsMultiBody は問いの側で落とすが、問いが十分でも答えが一言で済むことはある
const REVIEW_MIN_CHARS = 120

// 主体が答える → その答えを副体が検算する、という順序。
//
// 【なぜ統合をやめたか】
// 以前は「副体が先に検討メモを書く → 主体がそれを統合して答える」だった。
// 実測（docs/chat_see.log）で、統合は答えを良くしなかった:
//   ・副体のメモ由来の観点が主体の答えに移った数 …… 平均 0.1/run
//   ・単体なら出ていた観点が、統合すると落ちた数 …… 平均 1.2/run
// 入ってこないのに、出るものだけが減っていた。原因は副体の中身ではなく、主体に
// 「答える」と「まとめる」の二役を同時に負わせたこと。統合層は禁止事項の列挙
// （メモに言及するな・見出しを使うな・固有名を写すな）で、主体の注意は問いより先に
// 規則との照合へ向かう。具体名が 2.8 → 1.0 に落ちたのは、「心当たりの無い名前は
// 捨てろ」を守った結果、元々知っていた名前まで巻き添えで落ちたため。
//
// 順序を反転すると、主体は単体モードとまったく同じプロンプトで答える（＝劣化しない）。
// 副体の指摘は「答える前」ではなく「答えた後」に渡るので、主体の出力と衝突しない。
// 待ち時間も、副体ラウンドが本文の前から後ろへ移るぶん体感で縮む。
//
// `allBodies` は SSE の bodyIndex を求めるための元配列
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

  // 主体は常に単体モードと同じプロンプトで、最初に答える。
  // 他の体の存在を主体へ一切知らせないことが、この設計の要点
  res.write(`data: ${JSON.stringify({ type: 'answer_start', bodyIndex: allBodies.indexOf(primary) })}\n\n`)
  const answer = await streamBodyOAI(primary, messages, config, systemPrompt, res)

  // 検算に回すか。回さないなら answer_done の時点で応答は完成しており、
  // フロントはここで読み上げを締める（review:false）
  const willReview =
    secondaries.length > 0 && needsMultiBody(messages) && answer.trim().length >= REVIEW_MIN_CHARS
  res.write(`data: ${JSON.stringify({ type: 'answer_done', review: willReview })}\n\n`)
  if (!willReview) return

  const question = lastUserText(messages)

  // allSettled にしているのは、副体1体の失敗で他の体の検算まで落とさないため。
  // 本文はこの時点で既にユーザーへ届いているので、ここでの失敗は「カードが1枚欠ける」
  // だけに留まる（統合していた頃は、副体の失敗が答えそのものを揺らしていた）
  const settled = await Promise.allSettled(
    secondaries.map(async (b, i) => {
      const bodyIdx = allBodies.indexOf(b)
      const role    = resolveSecondaryRole(b.role, i)
      const name    = reviewRoleLabel(role)
      res.write(`data: ${JSON.stringify({ type: 'body_start', bodyIndex: bodyIdx, name, provider: b.provider })}\n\n`)
      // 全文を try の外に置くのは、body_done に「指摘が出たか」を載せるため。
      // 失敗した副体では空のままで、hasFinding は false になる
      let content = ''
      try {
        // 副体に渡すのは「問い」と「主体の答え」だけ。会話人格も履歴も渡さない（理由は
        // llm/secondaryPrompt.ts）。答えを渡すのは、検算の対象がその答えそのものだから
        content = await streamSecondaryBody(
          b,
          bodyIdx,
          buildReviewMessages(question, answer, role),
          { ...config, maxTokens: config.secondaryMaxTokens },
          buildReviewSystemPrompt(role),
          res,
        )
        return content
      } finally {
        // 成功・失敗のどちらでも必ず送る。送らないとフロントの pendingBodies から
        // この体が消えず、球体が分裂したまま固まる（useChat.ts の body_done ハンドラ）。
        //
        // hasFinding は「この副体が指摘を出したか」。判定は secondaryPrompt に1箇所だけ
        // 置き、読む側（表示・共有・実例の抽出）が本文の文字列を見ないで済むようにする
        res.write(`data: ${JSON.stringify({ type: 'body_done', bodyIndex: bodyIdx, hasFinding: hasReviewFinding(content, answer) })}\n\n`)
      }
    })
  )

  const secrets = collectSecrets({ bodies: allBodies })
  settled.forEach((result, i) => {
    if (result.status !== 'rejected') return
    const b    = secondaries[i]!
    const name = reviewRoleLabel(resolveSecondaryRole(b.role, i))
    // キーがエラー本文へ echo back されることがあるため、ログに出す前に必ず伏せ字化する
    console.error(`[検算] ${name}(${b.provider}) の応答に失敗しました:`, sanitizeErrorMessage(result.reason, secrets))
  })

  // 検算に何が渡ったかを見る窓。指摘が的外れなとき、原因が「答えが渡っていない」のか
  // 「モデルが小さい」のかは、渡した中身を見ないと切り分けられない
  if (process.env.DEBUG_SYNTHESIS?.trim().toLowerCase() === 'full') {
    console.info(`[検算] 答え ${answer.length}文字 / 副体 ${secondaries.length}体`)
    settled.forEach((r, i) => {
      const name = reviewRoleLabel(resolveSecondaryRole(secondaries[i]?.role, i))
      console.info(`[検算] ${name}: ${r.status === 'rejected' ? '失敗' : `${r.value.length}文字`}`)
    })
  }
}
