import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChat } from '../useChat'
import type { ErrorBlock, Message, TextBlock } from '../../types/message'

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

function textBlock(msg: Message, index = 0) {
  return msg.blocks[index] as TextBlock
}

function errorBlock(msg: Message, index = 0) {
  return msg.blocks[index] as ErrorBlock
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

      stopGeneration()
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
      stopGeneration()
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
  })
})
