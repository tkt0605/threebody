import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000'

export type SharedKeyReason = 'unavailable' | 'not_signed_in' | 'not_permitted' | 'limit_reached' | null

export interface SharedKeyCapability {
  allowed:    boolean
  remaining:  number
  dailyLimit: number
  reason:     SharedKeyReason
}

export interface OllamaCapability {
  enabled: boolean
}

const DEFAULT_SHARED_KEY: SharedKeyCapability = { allowed: false, remaining: 0, dailyLimit: 5, reason: null }
// バックエンド側の既定値（未設定なら true）に合わせる。フェッチ前をfalse扱いにすると、
// 取得が終わるまでの一瞬だけ「Ollamaも使えない」に見えてゲートがチラつく
const DEFAULT_OLLAMA: OllamaCapability = { enabled: true }

// module-level singleton — 他のcomposableと同様、コンポーネント間で状態を共有する
const sharedKey = ref<SharedKeyCapability>(DEFAULT_SHARED_KEY)
const ollama    = ref<OllamaCapability>(DEFAULT_OLLAMA)
// 未取得（初回フェッチ前）と「取得した結果allowed:false」を区別する。
// 区別しないと、読み込み中に一瞬だけ泣き顔が出てすぐ消える、が起きうる
const loaded = ref(false)

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function refreshCapabilities(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/api/capabilities`, { headers: await authHeader() })
    if (!response.ok) return
    const data = await response.json() as { sharedKey: SharedKeyCapability; ollama: OllamaCapability }
    sharedKey.value = data.sharedKey
    ollama.value    = data.ollama
    loaded.value    = true
  } catch {
    // バックエンド不通でも致命的ではない。既定値（allowed:false）のまま静かに諦める
    // （/api/chat 側は従来どおり動くので、ここが失敗してもチャット自体は失敗しない）
  }
}

export function useCapabilities() {
  return { sharedKey, ollama, loaded, refreshCapabilities }
}
