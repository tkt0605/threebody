import type express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BodyConfig, LevelConfig } from './types'
import { resolveBodyModel, toOllamaMessages, toAnthropicMessages, extractTextContent } from './messageHelpers'
import {
  buildSecondaryMessages, buildSecondarySystemPrompt, needsMultiBody,
  resolveSecondaryRole, secondaryRoleLabel,
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

// これを下回る見解しか集まらなかったら統合しない（＝単体モードに縮退）。
// 挨拶や相槌は副体2体を足しても100文字に届かず、逆に中身のある質問なら
// 副体は secondaryMaxTokens 近くまで書くため、この境界で綺麗に分かれる
const SYNTHESIS_MIN_CHARS = 120

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

  // 割れる余地の無い問い（挨拶・相槌）では副体を呼ばずに単体で答える。
  // ここで落とすぶん、無駄な2回の呼び出しも消える
  if (!needsMultiBody(messages)) {
    res.write(`data: ${JSON.stringify({ type: 'synthesis_start', bodyIndex: allBodies.indexOf(primary) })}\n\n`)
    await streamBodyOAI(primary, messages, config, systemPrompt, res)
    return
  }

  // allSettled にしているのは、副体1体の失敗で三体モードごと落とさないため。
  // Promise.all だと1体が throw した時点で reject し、他の体の見解も主体による統合も
  // まるごと失われる（＝「複数視点の統合」という売りと噛み合わない）
  const settled = await Promise.allSettled(
    secondaries.map(async (b, i) => {
      const bodyIdx = allBodies.indexOf(b)
      const role    = resolveSecondaryRole(b.role, i)
      const name    = secondaryRoleLabel(role)
      res.write(`data: ${JSON.stringify({ type: 'body_start', bodyIndex: bodyIdx, name, provider: b.provider })}\n\n`)
      try {
        // 副体には会話人格（systemPrompt）も履歴全文も渡さない。役ごとの検討メモ用の
        // system と、直近だけへ畳んだ問いを渡す（理由は llm/secondaryPrompt.ts）
        return await streamSecondaryBody(
          b,
          bodyIdx,
          buildSecondaryMessages(messages, role),
          { ...config, maxTokens: config.secondaryMaxTokens },
          buildSecondarySystemPrompt(role),
          res,
        )
      } finally {
        // 成功・失敗のどちらでも必ず送る。送らないとフロントの pendingBodies から
        // この体が消えず、球体が分裂したまま固まる（useChat.ts の body_done ハンドラ）
        res.write(`data: ${JSON.stringify({ type: 'body_done', bodyIndex: bodyIdx })}\n\n`)
      }
    })
  )

  const secrets = collectSecrets({ bodies: allBodies })
  // flatMap にしているのは、null を挟んでから filter するより型が素直に通るため
  const views = settled.flatMap((result, i) => {
    const b    = secondaries[i]!
    const name = secondaryRoleLabel(resolveSecondaryRole(b.role, i))
    if (result.status === 'rejected') {
      // 失敗した体は見解から除外して統合を続ける。キーがエラー本文へ
      // echo back されることがあるため、ログに出す前に必ず伏せ字化する
      console.error(`[三体] ${name}(${b.provider}) の応答に失敗しました:`, sanitizeErrorMessage(result.reason, secrets))
      return []
    }
    const view = stripCodeBlocks(result.value)
    if (!view.trim()) return []
    return [{ name, provider: b.provider, view }]
  })

  // 見出し（【○体（provider）の見解】）を除いた、中身そのものの分量
  const contentChars = views.reduce((n, v) => n + v.view.length, 0)
  const perspectives = views.map(v => `【${v.name}（${v.provider}）の見解】\n${v.view}`).join('\n\n')

  // 副体が全滅した場合、空の見解を「以下は他の体の見解です」に続けて注入すると
  // 主体が存在しない見解について語り出す。単体モードに縮退させる。
  //
  // 見解が短すぎる場合も同じく縮退させる。「おはよう」のような挨拶では副体2体が
  // ほぼ同じ一言を返し、統合すべき差分が存在しない。それでも統合を走らせると、
  // 主体は組み立てる材料が無いので隣の2文を継ぎ接ぎする（実測: 「どんなことで
  // 頭がいっぱい？」＋「どんなことを話したい？」→「どんなことで頭のなかにある？」と、
  // 助詞だけ引き写して述語が入れ替わった壊れた文になった）。
  // 統合する中身が無いなら、主体に普通に答えさせるほうが日本語として正しい
  if (!perspectives || contentChars < SYNTHESIS_MIN_CHARS) {
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

各見解は「崩れる点」「別の見方」「最初の一手」のように担当が分かれており、
どれも質問への答えではない。答えを書くのはあなただけだ。

【厳守】
- ユーザーの元の質問に、あなた自身の言葉で直接答える。
- 見解に対する感想・謝辞・論評を書かない。見解の存在に言及しない。
- ユーザーが具体物（コード・手順・文章）を求めているなら、まずそれ自体を出す。
  確認や質問は出したあとに1つだけ添えてよい。何も出さずに問い返して終わらない。
- 「確度: 低」「未確認」と書かれている内容は、事実として書かない。採るなら
  「〜の場合は」「〜なら」と条件付きで書くか、確かめる手順のほうを書く。
- 見解が誤っている・質問とずれている場合は、黙って捨てて自分で正しい答えを書く。
  全部捨てて自分で答えてよい。3つとも使う義務は無い。
- 見解どうしが食い違うときは、両論併記で逃げずに、どちらを採るか決めて答えに反映する。
- 見解の言い回しを切り貼りしない。助詞や語尾だけ残して述語を差し替えると文が壊れる。
  受け取るのは中身だけにして、文は必ず最初から自分で組み立てる。
- 見出し（崩れる点・別の見方 など）や箇条書きの形をそのまま答えに持ち込まない。
  資料の形式であって、ユーザーへの返答の形式ではない。
- 出す前に、日本語として助詞の係り受けが通っているか読み返す。`

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
      const name = secondaryRoleLabel(resolveSecondaryRole(b?.role, i))
      if (r.status === 'rejected') { console.info(`[統合] ${name}: 失敗`); return }
      // 形式を守れたか（＝会話として普通に回答していないか）を1行で見る。
      // 守れていない体は、モデルが小さすぎて役に立っていない側の証拠になる
      // 見出しは 「崩れる点:」「【崩れる点】」 どちらの形でも出る。名前が有るかだけを見る
      const 形式 = r.value.includes(secondaryRoleLabel(resolveSecondaryRole(b?.role, i))) ? '形式OK' : '★形式崩れ'
      const コード = r.value.includes('```') ? 'コードあり' : 'コードなし'
      console.info(`[統合] ${name}: ${r.value.length}文字 / ${形式} / ${コード}`)
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
