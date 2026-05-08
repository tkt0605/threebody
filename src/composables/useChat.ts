import { ref } from 'vue'
import type { Message, TextBlock } from '../types/message'
import { useSettings } from './useSettings'

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

    const assistantMsg: Message = {
      id: createId(),
      role: 'assistant',
      blocks: [{ type: 'text', content: '' }],
      timestamp: new Date(),
      streaming: true,
    }
    messages.value.push(assistantMsg)

    const block = assistantMsg.blocks[0] as TextBlock

    try {
      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(messages.value.slice(0, -1)),
          thinkingLevel: settings.thinkingLevel,
          systemPrompt: settings.systemPrompt || 'You are a helpful assistant. Please respond in Japanese.',
          provider: settings.provider,
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
      block.content = `エラー: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      assistantMsg.streaming = false
    }
  }

  return { messages, sendMessage }
}
