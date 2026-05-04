import { reactive } from 'vue'

export type Language = 'ja' | 'en'

export interface McpServer {
  id: string
  label: string
  enabled: boolean
}

export interface Settings {
  language: Language
  systemPrompt: string
  mcpServers: McpServer[]
}

const settings = reactive<Settings>({
  language: 'ja',
  systemPrompt: '',
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
