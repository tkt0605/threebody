import { ref } from 'vue'
import type { Message } from '../types/message'

const messages = ref<Message[]>([])

function createId() {
  return crypto.randomUUID()
}

export function useChat() {
  function sendMessage(text: string) {
    const userMsg: Message = {
      id: createId(),
      role: 'user',
      blocks: [{ type: 'text', content: text }],
      timestamp: new Date(),
    }
    messages.value.push(userMsg)

    // Mock assistant response
    const assistantMsg: Message = {
      id: createId(),
      role: 'assistant',
      blocks: [{ type: 'text', content: '...' }],
      timestamp: new Date(),
      streaming: true,
    }
    messages.value.push(assistantMsg)

    simulateStream(assistantMsg.id, `「${text}」を受け取りました。`)
  }

  function simulateStream(id: string, text: string) {
    const msg = messages.value.find(m => m.id === id)
    if (!msg) return
    const block = msg.blocks[0]
    if (block?.type !== 'text') return

    block.content = ''
    let i = 0
    const interval = setInterval(() => {
      if (i >= text.length) {
        clearInterval(interval)
        msg.streaming = false
        return
      }
      block.content += text[i]
      i++
    }, 30)
  }

  return { messages, sendMessage }
}
