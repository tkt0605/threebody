import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BodyConfig } from './types'
import { M } from './modelConfig'

// Ollamaはモデル未指定でもサーバー既定モデルで動く（キー無しの一体モードを最短で成立させる）
export function resolveBodyModel(body: BodyConfig): string {
  if (body.provider === 'ollama' && !body.model?.trim()) return M.ollama.default
  return body.model
}

export function extractTextContent(
  content: OpenAI.Chat.ChatCompletionMessageParam['content']
): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('')
  return ''
}

export function toOllamaMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
): { role: string; content: string }[] {
  const base = messages.map(m => ({ role: m.role, content: extractTextContent(m.content) }))
  return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...base] : base
}

export function toAnthropicMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Anthropic.MessageParam[]{
  return messages
    .filter((m): m is OpenAI.Chat.ChatCompletionUserMessageParam | OpenAI.Chat.ChatCompletionAssistantMessageParam =>
      m.role === 'user' || m.role === 'assistant'
    )
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
            .filter((p): p is { type: 'text'; text: string} => p.type === 'text')
            .map(p => p.text)
            .join('')
          : '',
    }))
}
