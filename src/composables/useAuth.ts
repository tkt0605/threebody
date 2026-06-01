import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

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
  }

  return { user, isAuthenticated, initialized, loginWithGoogle, logout }
}
