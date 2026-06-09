import { ref } from 'vue'
import type { Message, TextBlock } from '../types/message'
import { useSettings } from './useSettings'
import { buildSystemPrompt } from './useSystemPrompt'

const API_BASE = import.meta.env.VITE_API_BASE_URL as string

function classifyError(err: unknown): string {
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return 'ネットワークに接続できません。バックエンドが起動しているか確認してください。'
  }
  if (err instanceof Error) {
    if (err.message.startsWith('HTTP 429')) return 'APIの利用制限に達しました。しばらく経ってから再試行してください。'
    if (err.message.startsWith('HTTP 5'))   return `サーバーエラーが発生しました (${err.message})。`
    if (err.message.startsWith('HTTP '))    return `リクエストが失敗しました (${err.message})。`
    return err.message
  }
  return String(err)
}

const messages = ref<Message[]>([])

function createId() {
  return crypto.randomUUID()
}

function toApiMessages(msgs: Message[]) {
  return msgs.map(m => ({
    role: m.role,
    content: m.blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.content)
      .join(''),
  }))
}

export function useChat() {
  const { settings } = useSettings()

  async function sendMessage(text: string) {
    const userMsg: Message = {
      id: createId(),
      role: 'user',
      blocks: [{ type: 'text', content: text }],
      timestamp: new Date(),
    }
    messages.value.push(userMsg)

    messages.value.push({
      id: createId(),
      role: 'assistant',
      blocks: [{ type: 'text', content: '' }],
      timestamp: new Date(),
      streaming: true,
    })

    // push後にリアクティブ配列経由で参照することで Vue の Proxy を通す
    const reactiveMsg = messages.value[messages.value.length - 1]!
    const block = reactiveMsg.blocks[0] as TextBlock

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(messages.value.slice(0, -1)),
          thinkingLevel: settings.thinkingLevel,
          systemPrompt: buildSystemPrompt(settings),
          provider: settings.provider,
          bodies: settings.bodies,
          model:  settings.bodies.find(b => b.provider === settings.provider)?.model,
          apiKey: settings.bodies.find(b => b.provider === settings.provider)?.apiKey,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break outer
          try {
            const parsed = JSON.parse(data) as { type: string; content?: string; message?: string }
            if (parsed.type === 'text' && parsed.content) block.content += parsed.content
            if (parsed.type === 'error') throw new Error(parsed.message)
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
    } catch (err) {
      if (!block.content) reactiveMsg.blocks.shift()
      reactiveMsg.blocks.push({ type: 'error', message: classifyError(err) })
    } finally {
      reactiveMsg.streaming = false  // Proxy 経由で書くことで watch を発火させる
    }
  }

  return { messages, sendMessage }
}
