import type express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BodyConfig, LevelConfig } from './types'
import { resolveBodyModel, toOllamaMessages, toAnthropicMessages, extractTextContent } from './messageHelpers'
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

// 副体の見解からコードブロックを落とす。
//
// personaPrompt でも「コードを書くな」と頼んでいるが、小さいローカルモデルは守る回と
// 守らない回がある（実測で、同じ設定のまま片方の回だけ従った）。依頼ではなく処理で落とす。
//
// 落とす理由は分量だけではない。副体は secondaryMaxTokens しか持たないため、コードは
// たいてい途中で切れる。書きかけのコードを資料として渡すと、主体はそれを直そうとするか、
// 半端なまま引き写す。方針だけ受け取って主体が最初から書くほうが結果が良い。
//
// 閉じていないフェンス（生成が途中で切れた場合）も末尾ごと落とす
function stripCodeBlocks(text: string): string {
  const closed = text.replace(/```[\s\S]*?```/g, '\n（コード略）\n')
  const open   = closed.indexOf('```')
  const body   = open === -1 ? closed : `${closed.slice(0, open)}\n（コード略）\n`
  // 落とした跡に空行が固まるので、3行以上の連続改行は2行に畳む
  return body.replace(/\n{3,}/g, '\n\n').trim()
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

  // allSettled にしているのは、副体1体の失敗で三体モードごと落とさないため。
  // Promise.all だと1体が throw した時点で reject し、他の体の見解も主体による統合も
  // まるごと失われる（＝「複数視点の統合」という売りと噛み合わない）
  const settled = await Promise.allSettled(
    secondaries.map(async (b) => {
      const bodyIdx = allBodies.indexOf(b)
      const name    = b.name ?? '副体'
      res.write(`data: ${JSON.stringify({ type: 'body_start', bodyIndex: bodyIdx, name, provider: b.provider })}\n\n`)
      try {
        return await streamSecondaryBody(b, bodyIdx, messages, { ...config, maxTokens: config.secondaryMaxTokens }, b.personaPrompt ?? systemPrompt, res)
      } finally {
        // 成功・失敗のどちらでも必ず送る。送らないとフロントの pendingBodies から
        // この体が消えず、球体が分裂したまま固まる（useChat.ts の body_done ハンドラ）
        res.write(`data: ${JSON.stringify({ type: 'body_done', bodyIndex: bodyIdx })}\n\n`)
      }
    })
  )

  const secrets = collectSecrets({ bodies: allBodies })
  const perspectives = settled
    .map((result, i) => {
      const b    = secondaries[i]!
      const name = b.name ?? '副体'
      if (result.status === 'rejected') {
        // 失敗した体は見解から除外して統合を続ける。キーがエラー本文へ
        // echo back されることがあるため、ログに出す前に必ず伏せ字化する
        console.error(`[三体] ${name}(${b.provider}) の応答に失敗しました:`, sanitizeErrorMessage(result.reason, secrets))
        return null
      }
      const view = stripCodeBlocks(result.value)
      if (!view.trim()) return null
      return `【${name}（${b.provider}）の見解】\n${view}`
    })
    .filter(Boolean)
    .join('\n\n')

  // 副体が全滅した場合、空の見解を「以下は他の体の見解です」に続けて注入すると
  // 主体が存在しない見解について語り出す。単体モードに縮退させる
  if (!perspectives) {
    res.write(`data: ${JSON.stringify({ type: 'synthesis_start', bodyIndex: allBodies.indexOf(primary) })}\n\n`)
    await streamBodyOAI(primary, messages, config, systemPrompt, res)
    return
  }

  // 見解は system 側に置く。user ターンへ連結すると「ユーザーが資料を提示してきた」と
  // 読まれ、主体が質問に答える側ではなく資料に感想を述べる側に回る。
  // （実測: 見解をuserに入れていた頃の出力が「提示された複数の回答を見ると…」で始まり、
  //  求められたコードを出さずに問い返して終わっていた）
  const synthesisSystemPrompt = `${systemPrompt}

【統合タスク】
以下は、同じ質問に対する他のLLM（体）の見解です。
これはユーザーの発言ではなく、あなただけが見ている参考資料です。

${perspectives}

【厳守】
- ユーザーの元の質問に、あなた自身の言葉で直接答える。
- 見解に対する感想・謝辞・論評を書かない。見解の存在に言及しない。
- ユーザーが具体物（コード・手順・文章）を求めているなら、まずそれ自体を出す。
  確認や質問は出したあとに1つだけ添えてよい。何も出さずに問い返して終わらない。
- 見解が誤っている・質問とずれている場合は、黙って捨てて自分で正しい答えを書く。`

  res.write(`data: ${JSON.stringify({ type: 'synthesis_start', bodyIndex: allBodies.indexOf(primary) })}\n\n`)

  // 統合に何が渡ったかを見る窓。三体モードの不具合は「主体が受け取った内容」を見ないと、
  // プロンプトの組み方・副体の出力・モデルの能力のどれが原因か切り分けられない。
  //
  // 既定は要約（数行）だけにする。全文を毎ターン流すとターミナルが数百行で埋まり、
  // 肝心の判定行が流れて読めなくなる（出力コスト自体は推論時間に比べて無視できるが、
  // 読めないログは無いのと同じ）。全文が要るときだけ DEBUG_SYNTHESIS=full にする。
  // bodies / apiKey は絶対に出さないこと
  const debugLevel = process.env.DEBUG_SYNTHESIS?.trim().toLowerCase()
  if (debugLevel === 'true' || debugLevel === 'full') {
    settled.forEach((r, i) => {
      const b    = secondaries[i]
      const name = b?.name ?? '副体'
      if (r.status === 'rejected') { console.info(`[統合] ${name}: 失敗`); return }
      // 副体が指示を無視したのか、そもそも新しい指示が届いていないのかを切り分ける。
      // personaPrompt はフロント（constants/bodyPersonas.ts）で組まれて送られてくるため、
      // ブラウザが古いバンドルのままだと旧文面が届き続ける
      const 指示到達 = b?.personaPrompt?.includes('具体物を作るのは統合役の仕事') ? '到達' : '未到達'
      const コード   = r.value.includes('```') ? 'コードあり' : 'コードなし'
      console.info(`[統合] ${name}: ${r.value.length}文字 / ${コード} / 「書くな」指示=${指示到達}`)
    })

    // 本丸の検証。見解が user ターンへ漏れていないことを毎ターン確かめる
    const 漏れ = messages.some(m =>
      m.role === 'user' && extractTextContent(m.content).includes('の見解】')
    )
    console.info(`[統合] userターンへの見解の漏れ: ${漏れ ? '★あり（バグ再発）' : 'なし'} / 履歴${messages.length}件`)

    if (debugLevel === 'full') {
      console.info(`[統合] systemPrompt:\n${synthesisSystemPrompt}`)
      messages.forEach(m =>
        console.info(`[統合] [${m.role}] ${JSON.stringify(extractTextContent(m.content).slice(0, 200))}`)
      )
    }
  }

  // ユーザーターンは元の質問のまま渡す（加工しない）
  await streamBodyOAI(primary, messages, config, synthesisSystemPrompt, res)
}
