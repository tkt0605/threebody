import { reactive, watch } from 'vue'
import { decryptText, encryptText, type EncryptedPayload } from '../lib/keyVault'

// 7言語から2言語へ縮小した。読み上げ（ChatView の ttsLang）が元から ja / en の
// 2つしか持っておらず、中国語等を選ぶと「認識と本文は中国語・読み上げだけ英語」に
// なっていたため。i18n に着手する際は、ここではなく LANG_LOCALE / LANGUAGE_PROMPT /
// ttsLang の3つを揃えて戻すこと。
const LANGUAGE_VALUES = ['ja', 'en'] as const
export type Language = typeof LANGUAGE_VALUES[number]
export type VoiceStyle = 'formal' | 'casual' | 'terse' | 'warm'
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
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  // 変更する手段が無く、実質 'ollama' 固定になっている。
  // SettingsDialog は draft.provider を読み込むが save() が書き戻さないため、
  // ユーザーがUIから動かすことはできない。
  //
  // ただし死んだ値ではない。backend の単体モード経路（routes/chat.ts）は、
  // 三体モードの available.length === 0（3体すべてがクラウドでキー未設定、かつ
  // 共有キーも使えない）のとき return せずに下へ抜けて到達する。そこで参照されるのが
  // この provider で、既定値 'ollama' により Ollama フォールバックとして機能している。
  //
  // 変更UIを足すか、bodies へ一本化して消すかは未決。消す場合は backend 側の
  // 単体モード経路の扱い（/api/chat は curl 等の生リクエストも受ける前提）を先に決めること。
  provider: Provider
  // 共有キー（無料お試し枠）に乗るか。既定は true。
  //
  // OFF を用意したのは、バックエンドが「自分のクラウドキーが無ければ共有キー」を
  // 無条件で優先するため（routes/chat.ts）、ローカルLLMで話したい人が枠を使い切るまで
  // Ollama に降りられなかったから。OFF にすると共有キー経路を丸ごと飛ばし、
  // bodies の設定（＝三体モード / Ollama）がそのまま使われる
  useSharedKey: boolean
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

// 保存済みの値は型アサーションを通るだけで実行時の検証がされない。
// 7言語時代に 'zh' 等を選んだユーザーの localStorage がそのまま残っているため、
// ホワイトリストに無い値は 'ja' へ落とす（型を狭めただけでは防げない）
function toLanguage(v: unknown): Language {
  return (LANGUAGE_VALUES as readonly string[]).includes(v as string) ? (v as Language) : 'ja'
}

const settings = reactive<Settings>({
  language:      toLanguage(saved.language),
  voiceStyle:    (saved.voiceStyle    as VoiceStyle)    ?? 'warm',
  thinkingLevel: (saved.thinkingLevel as ThinkingLevel) ?? 3,
  systemPrompt:  saved.systemPrompt                     ?? '',
  provider:      (saved.provider      as Provider)      ?? 'ollama',
  // ?? ではなく !== false で見る。保存前のユーザー（undefined）は ON 側に倒したいが、
  // 明示的に false を保存した人の OFF は必ず維持する
  useSharedKey:  saved.useSharedKey !== false,
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

// 会話可能（＝有効）な体かどうかの共通判定。
// Ollamaはキー無し・モデル未指定でもサーバー既定モデルで動くため常に利用可能。
// クラウド系（GPT/Claude/DeepSeek）はAPIキーとモデルの両方が揃って初めて利用可能。
export function isBodyUsable(b: Pick<BodyConfig, 'provider' | 'apiKey' | 'model'>): boolean {
  if (b.provider === 'ollama') return true
  return b.apiKey.trim().length > 0 && b.model.trim().length > 0
}

// クラウド系（GPT/Claude/DeepSeek）のキーを自分で1つでも設定済みか。
// isBodyUsable は ollama を無条件 true にするため、「共有キーに頼っているか」の
// 判定には使えない（常に true になってしまう）。バックエンドの hasOwnCloudKey と対応させる
export function hasOwnCloudKey(bodies: readonly Pick<BodyConfig, 'provider' | 'apiKey' | 'model'>[]): boolean {
  return bodies.some(b => b.provider !== 'ollama' && b.apiKey.trim().length > 0 && b.model.trim().length > 0)
}

export function useSettings() {
  return { settings }
}
