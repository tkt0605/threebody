import { reactive } from 'vue'

export type Language = 'ja' | 'en'
export type ThinkingLevel = 1 | 2 | 3 | 4 | 5
export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'

export interface McpServer {
  id: string
  label: string
  enabled: boolean
}

export interface Settings {
  language: Language
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  provider: Provider
  mcpServers: McpServer[]
}

const settings = reactive<Settings>({
  language: 'ja',
  thinkingLevel: 3,
  systemPrompt: '',
  provider: 'ollama',
  mcpServers: [
    { id: 'filesystem', label: 'Filesystem',      enabled: false },
    { id: 'websearch',  label: 'Web Search',       enabled: false },
    { id: 'code',       label: 'Code Interpreter', enabled: false },
    { id: 'memory',     label: 'Memory',           enabled: false },
  ],
})

export function useSettings() {
  return { settings }
}
