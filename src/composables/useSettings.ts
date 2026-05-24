import { reactive, watch } from 'vue'

export type Language = 'ja' | 'en'
export type Sex = 'man' | 'woman'
export type ThinkingLevel = 1 | 2 | 3 | 4 | 5
export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'
export type BodyProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek'

export interface BodyConfig {
  provider: BodyProvider
  apiKey: string
  model: string
}

export interface McpServer {
  id: string
  label: string
  enabled: boolean
}

export interface Settings {
  language: Language
  sex: Sex
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  provider: Provider
  bodies: [BodyConfig, BodyConfig, BodyConfig]
  mcpServers: McpServer[]
}

const STORAGE_KEY = 'threebody-settings'

const DEFAULT_MCP_SERVERS: McpServer[] = [
  { id: 'filesystem', label: 'Filesystem',      enabled: false },
  { id: 'websearch',  label: 'Web Search',       enabled: false },
  { id: 'code',       label: 'Code Interpreter', enabled: false },
  { id: 'memory',     label: 'Memory',           enabled: false },
]

const DEFAULT_BODIES: [BodyConfig, BodyConfig, BodyConfig] = [
  { provider: 'ollama',    apiKey: '',  model: 'llama3.2:1b' },
  { provider: 'openai',    apiKey: '',  model: 'gpt-4o-mini' },
  { provider: 'deepseek',  apiKey: '',  model: 'deepseek-chat' },
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
  systemPrompt:  saved.systemPrompt                     ?? 'あなたは、駒田隆人によって開発された高度なAIアシスタントです。ユーザーの質問に対して、正確かつ簡潔な回答を提供してください。必要に応じて、コード例や具体的な手順を示すこともできます。',
  provider:      (saved.provider      as Provider)      ?? 'ollama',
  sex:           (saved.sex           as Sex)           ?? 'man',
  bodies:        saved.bodies                           ?? DEFAULT_BODIES,
  mcpServers:    saved.mcpServers                       ?? DEFAULT_MCP_SERVERS,
})

watch(settings, (val) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
}, { deep: true })

export function useSettings() {
  return { settings }
}
