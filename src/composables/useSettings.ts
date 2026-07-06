import { reactive, watch } from 'vue'

export type Language = 'ja' | 'en' | 'zh' | 'ko' | 'fr' | 'es' | 'de'
export type VoiceStyle = 'formal' | 'casual' | 'terse' | 'warm'
export type Preset = 'general' | 'coding' | 'creative' | 'chat'
export type ThinkingLevel = 1 | 2 | 3 | 4 | 5
export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'
export type BodyProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek'

export interface BodyConfig {
  provider: BodyProvider
  apiKey: string
  model: string
}

export interface Settings {
  language: Language
  voiceStyle: VoiceStyle
  preset: Preset
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  provider: Provider
  bodies: [BodyConfig, BodyConfig, BodyConfig]
}

const STORAGE_KEY = 'threebody-settings'

const DEFAULT_BODIES: [BodyConfig, BodyConfig, BodyConfig] = [
  { provider: 'ollama',   apiKey: '', model: '' },
  { provider: 'openai',   apiKey: '', model: '' },
  { provider: 'deepseek', apiKey: '', model: '' },
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
  voiceStyle:    (saved.voiceStyle    as VoiceStyle)    ?? 'warm',
  preset:        (saved.preset        as Preset)        ?? 'general',
  thinkingLevel: (saved.thinkingLevel as ThinkingLevel) ?? 3,
  systemPrompt:  saved.systemPrompt                     ?? '',
  provider:      (saved.provider      as Provider)      ?? 'ollama',
  bodies:        ([0, 1, 2] as number[]).map(i => (saved.bodies?.[i] ?? DEFAULT_BODIES[i])) as [BodyConfig, BodyConfig, BodyConfig],
})

watch(settings, (val) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
}, { deep: true })

export function useSettings() {
  return { settings }
}
