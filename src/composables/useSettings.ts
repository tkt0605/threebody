import { reactive, watch } from 'vue'
import { decryptText, encryptText, type EncryptedPayload } from '../lib/keyVault'

export type Language = 'ja' | 'en' | 'zh' | 'ko' | 'fr' | 'es' | 'de'
export type VoiceStyle = 'formal' | 'casual' | 'terse' | 'warm'
export type Preset = 'general' | 'coding' | 'creative' | 'chat'
export type ThinkingLevel = 1 | 2 | 3 | 4 | 5
export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'
export type BodyProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek'
export type BodyPersona = 'optimist' | 'skeptic' | 'realist'
export interface BodyConfig {
  role: BodyPersona,
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
  { role: 'optimist', provider: 'ollama',   apiKey: '', model: '' },
  { role: 'skeptic', provider: 'openai',   apiKey: '', model: '' },
  { role: 'realist', provider: 'deepseek', apiKey: '', model: '' },
]

// localStorageにはapiKeyを平文で持たない。暗号文(apiKeyEnc)だけを保存し、
// 復号用のCryptoKeyはIndexedDBに非exportableな形で保持する（keyVault.ts）。
type StoredBody = Omit<BodyConfig, 'apiKey'> & { apiKeyEnc?: EncryptedPayload | null }
type StoredSettings = Omit<Settings, 'bodies'> & { bodies?: StoredBody[] }

function loadRaw(): Partial<StoredSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<StoredSettings>) : {}
  } catch {
    return {}
  }
}

const saved = loadRaw()

const settings = reactive<Settings>({
  language:      (saved.language      as Language)      ?? 'ja',
  voiceStyle:    (saved.voiceStyle    as VoiceStyle)    ?? 'warm',
  preset:        (saved.preset        as Preset)        ?? 'general',
  thinkingLevel: (saved.thinkingLevel as ThinkingLevel) ?? 3,
  systemPrompt:  saved.systemPrompt                     ?? '',
  provider:      (saved.provider      as Provider)      ?? 'ollama',
  bodies:        ([0, 1, 2] as number[]).map(i => ({
    ...DEFAULT_BODIES[i],
    ...saved.bodies?.[i],
    apiKey: '',
  })) as [BodyConfig, BodyConfig, BodyConfig],
})

let writeVersion = 0

// 起動時に暗号文を復号してapiKeyへ反映（非同期のため一瞬空欄になる）。
// 旧バージョン（平文apiKeyをそのままlocalStorageに保存していた形式）が残っている場合は、
// ユーザーが設定を変更するのを待たずにその場で暗号化形式へ移行する。
void (async () => {
  if (!saved.bodies) return
  let needsMigration = false
  for (let i = 0; i < saved.bodies.length && i < 3; i++) {
    const raw = saved.bodies[i] as (StoredBody & { apiKey?: string }) | undefined
    if (!raw) continue
    if (raw.apiKeyEnc) {
      try {
        settings.bodies[i]!.apiKey = await decryptText(raw.apiKeyEnc)
      } catch {
        // 復号できない（鍵消失・壊れたデータ等）場合は空欄のまま→ユーザーに再入力させる
      }
    } else if (raw.apiKey) {
      settings.bodies[i]!.apiKey = raw.apiKey
      needsMigration = true
    }
  }
  if (needsMigration) {
    void persist(settings, ++writeVersion)
  }
})()

watch(settings, (val) => {
  const myVersion = ++writeVersion
  void persist(val, myVersion)
}, { deep: true })

async function persist(val: Settings, version: number): Promise<void> {
  const bodies: StoredBody[] = []
  for (const b of val.bodies) {
    const { apiKey, ...rest } = b
    const stored: StoredBody = { ...rest }
    stored.apiKeyEnc = apiKey ? await encryptText(apiKey) : null
    bodies.push(stored)
  }
  // 暗号化中に新しい変更が入っていたら、この結果は捨てて次の書き込みに任せる
  if (version !== writeVersion) return
  const { bodies: _omit, ...rest } = val
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, bodies }))
}

export function useSettings() {
  return { settings }
}
