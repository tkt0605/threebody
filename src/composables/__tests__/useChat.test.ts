import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChat, HISTORY_LIMIT } from '../useChat'
import type { ErrorBlock, Message, PerspectiveBlock, TextBlock } from '../../types/message'

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function mockResponse(opts: { ok?: boolean; status?: number; body?: ReadableStream<Uint8Array> | null }): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    body: opts.body ?? null,
  } as unknown as Response
}

// 応答を返さず、signal が中断されたときだけ reject する fetch。
// 本物の fetch は「渡された時点で既に中断済み」なら即座に reject するため、
// そこも再現しておく（しないと中断済みシグナルで永久に待ち続ける）
function abortAwareFetch() {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      const fail = () => reject(new DOMException('Aborted', 'AbortError'))
      if (init.signal!.aborted) return fail()
      init.signal!.addEventListener('abort', fail)
    })
  )
}

// 指定のSSEを流したあと、中断されるまで閉じないfetch。
// 「途中まで届いているところへ停止が入る」状況を作るために使う
function hangingFetch(chunks: string[]) {
  const encoder = new TextEncoder()
  return vi.fn().mockImplementation((_url: string, init: RequestInit) =>
    Promise.resolve(mockResponse({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          // 本物の fetch と同じく、中断時は読み取り側を AbortError で失敗させる
          init.signal!.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          })
        },
      }),
    }))
  )
}

function textBlock(msg: Message, index = 0) {
  return msg.blocks[index] as TextBlock
}

function errorBlock(msg: Message, index = 0) {
  return msg.blocks[index] as ErrorBlock
}

function perspectiveBlock(msg: Message) {
  return msg.blocks.find((b): b is PerspectiveBlock => b.type === 'perspective')
}

describe('useChat', () => {
  beforeEach(() => {
    // messages はモジュールレベルの singleton ref のためテスト間でリセットする
    useChat().messages.value = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('送信時にユーザーメッセージとストリーミング中のアシスタントメッセージを積む', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: sseStream(['data: [DONE]\n\n']) })))

    const { messages, sendMessage } = useChat()
    await sendMessage('こんにちは')

    expect(messages.value).toHaveLength(2)
    expect(messages.value[0]?.role).toBe('user')
    expect(textBlock(messages.value[0]!).content).toBe('こんにちは')
    expect(messages.value[1]?.role).toBe('assistant')
    expect(messages.value[1]?.streaming).toBe(false)
  })

  // 会話が伸びるほど入力トークンが線形に増え、三体モードではそれが3倍になる。
  // 全件送信に戻ると気づかないままコストが膨らむため、ここで固定する
  describe('履歴の切り詰め', () => {
    // 送信ボディの messages を取り出す
    function sentMessages(fetchMock: ReturnType<typeof vi.fn>): { role: string; content: string }[] {
      const init = fetchMock.mock.calls[0]![1] as RequestInit
      return (JSON.parse(init.body as string) as { messages: { role: string; content: string }[] }).messages
    }

    it(`直近 ${HISTORY_LIMIT} 件だけを送る`, async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse({ body: sseStream(['data: [DONE]\n\n']) }))
      vi.stubGlobal('fetch', fetchMock)

      const { messages, sendMessage } = useChat()
      // 上限を超える履歴を積む（古い順に 0,1,2,...）
      messages.value = Array.from({ length: HISTORY_LIMIT + 6 }, (_, i) => ({
        id:        `m${i}`,
        role:      i % 2 === 0 ? 'user' as const : 'assistant' as const,
        timestamp: new Date(),
        modality:  'text' as const,
        blocks:    [{ type: 'text' as const, content: `古い発言${i}` }],
      }))

      await sendMessage('最新の発言')

      const sent = sentMessages(fetchMock)
      expect(sent).toHaveLength(HISTORY_LIMIT)
      // 末尾から取ること。直近の文脈のほうが応答に効く
      expect(sent.at(-1)?.content).toBe('最新の発言')
      // 溢れた古い発言は落ちている
      expect(sent.some(m => m.content === '古い発言0')).toBe(false)
    })

    it('上限以下なら全件そのまま送る', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse({ body: sseStream(['data: [DONE]\n\n']) }))
      vi.stubGlobal('fetch', fetchMock)

      const { sendMessage } = useChat()
      await sendMessage('こんにちは')

      // 送信対象は「自分の発言まで」（応答用のプレースホルダは含めない）
      expect(sentMessages(fetchMock)).toEqual([{ role: 'user', content: 'こんにちは' }])
    })

    // 中断された応答は本文を持たないことがある。そのまま送ると「何も言わなかった
    // アシスタント」が履歴に並び、文脈を汚したうえ上限の枠まで食う
    it('本文が空のターンは送らない', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse({ body: sseStream(['data: [DONE]\n\n']) }))
      vi.stubGlobal('fetch', fetchMock)

      const { messages, sendMessage } = useChat()
      messages.value = [
        { id: 'u1', role: 'user',      timestamp: new Date(), modality: 'text', blocks: [{ type: 'text', content: '前の質問' }] },
        // 一文字も書かれないまま中断された応答
        { id: 'a1', role: 'assistant', timestamp: new Date(), modality: 'text', blocks: [] },
      ]

      await sendMessage('次の質問')

      expect(sentMessages(fetchMock)).toEqual([
        { role: 'user', content: '前の質問' },
        { role: 'user', content: '次の質問' },
      ])
    })
  })

  it('SSEのtextイベントを順番に連結してストリーミング表示する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      body: sseStream([
        'data: {"type":"text","content":"こん"}\n\n',
        'data: {"type":"text","content":"にちは"}\n\n',
        'data: [DONE]\n\n',
      ]),
    })))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    const assistant = messages.value[1]!
    expect(textBlock(assistant).content).toBe('こんにちは')
    expect(assistant.streaming).toBe(false)
  })

  it('5xxエラーはサーバーエラーメッセージに分類する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500 })))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    const assistant = messages.value[1]!
    expect(assistant.blocks).toHaveLength(1)
    expect(errorBlock(assistant).message).toBe('サーバーエラーが発生しました (HTTP 500)。')
    expect(assistant.streaming).toBe(false)
  })

  it('429エラーは利用制限メッセージに分類する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 429 })))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    expect(errorBlock(messages.value[1]!).message).toBe('APIの利用制限に達しました。しばらく経ってから再試行してください。')
  })

  it('429・5xx以外のHTTPエラーは汎用のリクエスト失敗メッセージにする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 })))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    expect(errorBlock(messages.value[1]!).message).toBe('リクエストが失敗しました (HTTP 404)。')
  })

  it('fetch自体が失敗した場合はネットワークエラーメッセージを表示する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    expect(errorBlock(messages.value[1]!).message).toBe('ネットワークに接続できません。バックエンドが起動しているか確認してください。')
  })

  it('ストリーミング途中でエラーイベントを受け取った場合は途中までのテキストを残してエラーを追加する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      body: sseStream([
        'data: {"type":"text","content":"途中まで"}\n\n',
        'data: {"type":"error","message":"内部エラー"}\n\n',
      ]),
    })))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    const assistant = messages.value[1]!
    expect(assistant.blocks).toHaveLength(2)
    expect(textBlock(assistant).content).toBe('途中まで')
    expect(errorBlock(assistant, 1).message).toBe('内部エラー')
    expect(assistant.streaming).toBe(false)
  })

  it('テキストが空のままエラーになった場合は空のテキストブロックを取り除いてエラーのみ残す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      body: sseStream(['data: {"type":"error","message":"開始直後にエラー"}\n\n']),
    })))

    const { messages, sendMessage } = useChat()
    await sendMessage('hi')

    const assistant = messages.value[1]!
    expect(assistant.blocks).toHaveLength(1)
    expect(errorBlock(assistant).message).toBe('開始直後にエラー')
  })

  describe('生成の中断', () => {
    it('fetch に AbortSignal を渡している', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse({ body: sseStream(['data: [DONE]\n\n']) }))
      vi.stubGlobal('fetch', fetchMock)

      const { sendMessage } = useChat()
      await sendMessage('hi')

      const init = fetchMock.mock.calls[0]![1] as RequestInit
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal!.aborted).toBe(false)
    })

    it('stopGeneration で進行中の応答を中断し、aiState を idle に戻す', async () => {
      // レスポンスが返る前に中断されるケース（＝最も長く走りうる区間）を再現する
      let abortSignal: AbortSignal | undefined
      const fetchMock = abortAwareFetch()
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => {
        abortSignal = init.signal!
        return fetchMock(url, init)
      }))

      const { sendMessage, stopGeneration, aiState, messages } = useChat()
      const inFlight = sendMessage('hi')
      await vi.waitFor(() => expect(abortSignal).toBeDefined())

      stopGeneration('user')
      await inFlight

      expect(abortSignal!.aborted).toBe(true)
      expect(aiState.value).toBe('idle')
      // 中断はエラーではないので、エラーブロックを足さない
      expect(messages.value[1]!.blocks.some(b => b.type === 'error')).toBe(false)
    })

    it('中断されても次の送信は通常どおり動く', async () => {
      vi.stubGlobal('fetch', abortAwareFetch())

      const { sendMessage, stopGeneration, aiState } = useChat()
      const first = sendMessage('1回目')
      stopGeneration('user')
      await first
      expect(aiState.value).toBe('idle')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
        body: sseStream(['data: {"type":"text","content":"2回目の応答"}\n\n', 'data: [DONE]\n\n']),
      })))
      const { messages } = useChat()
      await sendMessage('2回目')

      expect(textBlock(messages.value.at(-1)!).content).toBe('2回目の応答')
      expect(aiState.value).toBe('idle')
    })

    // 応答が始まる前に次を送る経路（連打・テキスト入力からの送信）。
    // cancelGeneration を通らないので、空の器を片付ける人が他にいない
    it('次の送信で中断された空の応答を、配列に残さない', async () => {
      vi.stubGlobal('fetch', abortAwareFetch())

      const { messages, sendMessage } = useChat()
      const first = sendMessage('1回目')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
        body: sseStream(['data: {"type":"text","content":"2回目の応答"}\n\n', 'data: [DONE]\n\n']),
      })))
      await sendMessage('2回目')   // ここで 1回目 が 'resend' で中断される
      await first

      // 幽霊（0ブロックのアシスタント）が残っていないこと。
      // 残ると画面には出ないのに toApiMessages が空ターンとしてLLMへ送り続ける
      expect(messages.value.some(m => m.blocks.length === 0)).toBe(false)
      expect(messages.value.map(m => m.role)).toEqual(['user', 'user', 'assistant'])
      expect(textBlock(messages.value.at(-1)!).content).toBe('2回目の応答')
    })

    // ユーザーが「停止」を押す経路。会話切替による中断と違い、画面はそのまま残るため、
    // 中身の無い応答バブルが残らないこと・送り直せることまでが仕様
    describe('cancelGeneration（ユーザーによる停止）', () => {
      it('まだ何も書かれていない応答メッセージを取り除き、直前の発言を宙ぶらりんに戻す', async () => {
        vi.stubGlobal('fetch', abortAwareFetch())

        const { messages, sendMessage, cancelGeneration, aiState } = useChat()
        const inFlight = sendMessage('hi')
        expect(messages.value).toHaveLength(2)

        cancelGeneration()
        await inFlight

        // 発言者名だけのバブルを残さない。ユーザー発言だけが残り、
        // MessageList 側の orphaned 判定で「もう一度送信／削除する」が出る状態になる
        expect(messages.value).toHaveLength(1)
        expect(messages.value[0]?.role).toBe('user')
        expect(aiState.value).toBe('idle')
      })

      it('途中まで書かれた応答は消さずに残す', async () => {
        vi.stubGlobal('fetch', hangingFetch(['data: {"type":"text","content":"途中まで"}\n\n']))

        const { messages, sendMessage, cancelGeneration } = useChat()
        const inFlight = sendMessage('hi')
        await vi.waitFor(() => expect(textBlock(messages.value[1]!).content).toBe('途中まで'))

        cancelGeneration()
        await inFlight

        expect(messages.value).toHaveLength(2)
        expect(textBlock(messages.value[1]!).content).toBe('途中まで')
      })

      it('生成していないときに押しても何も起きない', async () => {
        const { messages, cancelGeneration } = useChat()
        messages.value = [{
          id: 'a1', role: 'assistant', timestamp: new Date(), modality: 'text',
          blocks: [{ type: 'text', content: '' }],
        }]

        cancelGeneration()

        // inFlight が無いときは（空でも）既存のメッセージに触らない
        expect(messages.value).toHaveLength(1)
        expect(messages.value[0]?.signals).toBeUndefined()
      })

      // I0（記録）。停止とバージインは ChatView の handleStop / handleBargeIn から
      // どちらもここへ来るため、interrupted はこの1箇所で立つ
      it('途中まで書かれた応答に interrupted を立てる', async () => {
        vi.stubGlobal('fetch', hangingFetch(['data: {"type":"text","content":"途中まで"}\n\n']))

        const { messages, sendMessage, cancelGeneration } = useChat()
        const inFlight = sendMessage('hi')
        await vi.waitFor(() => expect(textBlock(messages.value[1]!).content).toBe('途中まで'))

        cancelGeneration()
        await inFlight

        expect(messages.value[1]!.signals?.interrupted).toBe(true)
      })

      // 割り込みで応答が捨てられた直後の発話は「新しい問い」ではなく「言い直し」。
      // 並べると同じ主旨の断片が2つ残り、履歴も次のリクエストの文脈も壊れる
      it('応答が捨てられた直後の発話は、前の発言を置き換える', async () => {
        vi.stubGlobal('fetch', abortAwareFetch())

        const { messages, sendMessage, cancelGeneration } = useChat()
        const first = sendMessage('そうだね えっと 例えば僕がね')
        cancelGeneration()
        await first
        expect(messages.value).toHaveLength(1)

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: sseStream(['data: [DONE]\n\n']) })))
        await sendMessage('明日の天気を教えて')

        // user メッセージは増えない（置き換わっている）
        expect(messages.value.filter(m => m.role === 'user')).toHaveLength(1)
        expect(textBlock(messages.value[0]!).content).toBe('明日の天気を教えて')
        // 失われた1回目の本文は残さないが、言い直した事実は記録する
        expect(messages.value[0]!.signals?.rephrased).toBe(1)
      })

      // 0文字で止められた応答は画面から取り除かれるが、「答えが要らなかった」という
      // 最も強いシグナルなので、器そのものは signals を持ったまま残る（persistMessage が拾う）
      it('0文字で止めても、取り除いた器に interrupted が残っている', async () => {
        vi.stubGlobal('fetch', abortAwareFetch())

        const { messages, sendMessage, cancelGeneration } = useChat()
        const assistantMsg = (() => {
          const p = sendMessage('hi')
          return { promise: p, msg: messages.value[1]! }
        })()

        cancelGeneration()
        await assistantMsg.promise

        // 画面上は取り除かれている
        expect(messages.value).toHaveLength(1)
        // 取り除かれた器には記録が残っている
        expect(assistantMsg.msg.signals?.interrupted).toBe(true)
      })
    })
  })

  // ── 検算方式 ─────────────────────────────────────────────────────────
  // 統合方式では主体の本文が副体の後に来ていた。反転後は本文が先に完成し、
  // 検算カードが後から続く。この順序と「本文の完成で締める」が新設計の要
  describe('検算（answer_done と検算カード）', () => {
    // 読み上げの締めは ChatView が streaming の false を見て narration.end を呼ぶ。
    // ここが検算の完了まで待つと、本文を読み終えた後に無音が数秒〜十数秒入る
    it('answer_done で本文を締める。検算カードの完了は待たない', async () => {
      vi.stubGlobal('fetch', hangingFetch([
        'data: {"type":"answer_start","bodyIndex":0}\n\n',
        'data: {"type":"text","content":"本文"}\n\n',
        'data: {"type":"answer_done","review":true}\n\n',
        'data: {"type":"body_start","bodyIndex":1,"name":"崩れる点","provider":"ollama"}\n\n',
      ]))

      const { messages, sendMessage, cancelGeneration, aiState } = useChat()
      const inFlight = sendMessage('hi')
      await vi.waitFor(() => expect(aiState.value).toBe('reviewing'))

      const msg = messages.value[1]!
      // 本文は完成している＝読み上げを締めてよい
      expect(msg.streaming).toBe(false)
      // 一方で検算はまだ終わっていない
      expect(perspectiveBlock(msg)!.bodies[0]!.done).toBe(false)

      cancelGeneration()
      await inFlight
    })

    it('review が false なら検算へ進まない', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
        body: sseStream([
          'data: {"type":"answer_start","bodyIndex":0}\n\n',
          'data: {"type":"text","content":"おはよう。"}\n\n',
          'data: {"type":"answer_done","review":false}\n\n',
          'data: [DONE]\n\n',
        ]),
      })))

      const { messages, sendMessage, aiState } = useChat()
      await sendMessage('おはよう')

      const msg = messages.value[1]!
      expect(msg.streaming).toBe(false)
      expect(perspectiveBlock(msg)).toBeUndefined()
      expect(aiState.value).toBe('idle')
    })

    // sort_order は blocks 配列の位置そのもの。ここが逆になると、リロード後だけ
    // カードが本文の上に戻る（統合方式の頃は unshift でそれが正しかった）
    it('検算カードを本文ブロックの後ろに積む', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
        body: sseStream([
          'data: {"type":"answer_start","bodyIndex":0}\n\n',
          'data: {"type":"text","content":"本文"}\n\n',
          'data: {"type":"answer_done","review":true}\n\n',
          'data: {"type":"body_start","bodyIndex":1,"name":"崩れる点","provider":"ollama"}\n\n',
          'data: {"type":"body_text","bodyIndex":1,"content":"崩れる点: "}\n\n',
          'data: {"type":"body_text","bodyIndex":1,"content":"出典が未確認"}\n\n',
          'data: {"type":"body_done","bodyIndex":1}\n\n',
          'data: [DONE]\n\n',
        ]),
      })))

      const { messages, sendMessage, pendingBodies } = useChat()
      await sendMessage('設計はどうする？')

      const msg = messages.value[1]!
      expect(msg.blocks.map(b => b.type)).toEqual(['text', 'perspective'])
      expect(textBlock(msg).content).toBe('本文')

      const card = perspectiveBlock(msg)!.bodies[0]!
      expect(card.name).toBe('崩れる点')
      expect(card.content).toBe('崩れる点: 出典が未確認')
      expect(card.done).toBe(true)
      expect(pendingBodies.value).toHaveLength(0)
    })
  })
})
