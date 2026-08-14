import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000'

// Module-level singleton — shared across all components
const user        = ref<User | null>(null)
const initialized = ref(false)

// Restore session on page load, then subscribe to changes
supabase.auth.getSession().then(({ data }) => {
  user.value  = data.session?.user ?? null
  initialized.value = true
})

supabase.auth.onAuthStateChange((_, session) => {
  user.value = session?.user ?? null
})

export function useAuth() {
  const isAuthenticated = computed(() => user.value !== null)

  // Google OAuth（PKCE）。/auth/callback で code をセッションに交換する
  async function loginWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google', 
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
  }

  async function logout(): Promise<void> {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    console.log('Logged out')
  }

  // 退会。アカウント本体（auth.users）は anon key では消せないため、
  // service_role を持つバックエンドに委ねる（backend/routes/account.ts）。
  // 会話単位の削除（useChat.deleteConversation）と違い、こちらはRLSの外側の操作になる
  async function deleteAccount(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('ログインしていません')

    const res = await fetch(`${API_BASE}/api/account`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.error ?? 'アカウントの削除に失敗しました')
    }

    // 削除済みユーザーのトークンでサーバーへサインアウトを投げても弾かれるだけなので、
    // ローカルのセッションだけを確実に捨てる。ここを飛ばすと、消えたはずのアカウントで
    // ログイン済みの画面が残り続ける
    await supabase.auth.signOut({ scope: 'local' })
    user.value = null
  }

  return { user, isAuthenticated, initialized, loginWithGoogle, logout, deleteAccount }
}
