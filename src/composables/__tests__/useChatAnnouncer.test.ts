import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChat } from '../useChat'
import { useChatAnnouncer, describeCompletedMessage } from '../useChatAnnouncer'
import type { Message } from '../../types/message'

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function mockResponse(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response
}

function assistant(blocks: Message['blocks']): Message {
  return { id: 'a1', role: 'assistant', timestamp: new Date(), modality: 'text', blocks }
}

describe('describeCompletedMessage', () => {
  it('本文はMarkdown記法を落としてから読み上げ文にする', () => {
    const line = describeCompletedMessage(assistant([
      { type: 'text', content: '## 見出し\n**太字**の答え' },
    ]))
    expect(line).toBe('応答: 見出し\n太字の答え')
  })

  it('三体モードの見解ブロックは読み上げず、統合された本文だけを読む', () => {
    const line = describeCompletedMessage(assistant([
      { type: 'perspective', bodies: [{ bodyIndex: 1, name: '二体', provider: 'openai', content: '副体の見解', done: true }] },
      { type: 'text', content: '統合した答え' },
    ]))
    expect(line).toBe('応答: 統合した答え')
  })

  // 失敗したことは、画面が見えない状態でこそ真っ先に伝わる必要がある
  it('エラーブロックがあればエラーとして読む', () => {
    const line = describeCompletedMessage(assistant([{ type: 'error', message: '接続できませんでした' }]))
    expect(line).toBe('エラー: 接続できませんでした')
  })

  it('ユーザーの発言は読み上げない（自分が話した内容のため）', () => {
    const msg: Message = { id: 'u1', role: 'user', timestamp: new Date(), modality: 'text', blocks: [{ type: 'text', content: 'やあ' }] }
    expect(describeCompletedMessage(msg)).toBe('')
  })
})

describe('useChatAnnouncer', () => {
  beforeEach(() => {
    useChat().messages.value = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('応答が完成した時点で本文をアナウンスする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(sseStream([
      'data: {"type":"text","content":"完成した"}\n\n',
      'data: {"type":"text","content":"応答"}\n\n',
      'data: [DONE]\n\n',
    ]))))

    const { announcement } = useChatAnnouncer()
    await useChat().sendMessage('hi')

    // ストリーミング中は1トークンごとに読み直さず、完成後に1度だけ流す
    await vi.waitFor(() => expect(announcement.value).toBe('応答: 完成した応答'))
  })

  it('同じ文言が続くときも読み直せるよう、直前と同一なら差分をつける', () => {
    const { announcement, announce } = useChatAnnouncer()

    announce('生成を停止しました')
    expect(announcement.value).toBe('生成を停止しました')

    announce('生成を停止しました')
    expect(announcement.value).not.toBe('生成を停止しました')
    // 読み上げられる内容そのものは変えない（見えない文字を足すだけ）
    expect(announcement.value.replace(/\u200B/g, '')).toBe('生成を停止しました')
  })
})
