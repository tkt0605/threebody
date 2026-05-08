import { reactive, watch } from 'vue'

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

const STORAGE_KEY = 'threebody-settings'

const DEFAULT_MCP_SERVERS: McpServer[] = [
  { id: 'filesystem', label: 'Filesystem',      enabled: false },
  { id: 'websearch',  label: 'Web Search',       enabled: false },
  { id: 'code',       label: 'Code Interpreter', enabled: false },
  { id: 'memory',     label: 'Memory',           enabled: false },
]

function load(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {}
  } catch {
    return {}
  }
}

const saved = load()

const settings = reactive<Settings>({
  language:      (saved.language      as Language)      ?? 'ja',
  thinkingLevel: (saved.thinkingLevel as ThinkingLevel) ?? 3,
  systemPrompt:  saved.systemPrompt                     ?? '',
  provider:      (saved.provider      as Provider)      ?? 'ollama',
  mcpServers:    saved.mcpServers                       ?? DEFAULT_MCP_SERVERS,
})

watch(settings, (val) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
}, { deep: true })

export function useSettings() {
  return { settings }
}
