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

  async function login(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signup(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // Supabase returns a session when email confirmation is disabled
    return { needsConfirmation: !data.session }
  }

  async function logout(): Promise<void> {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return { user, isAuthenticated, initialized, login, signup, logout }
}
