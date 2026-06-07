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
})
