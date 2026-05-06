<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'

const router = useRouter()
const { login } = useAuth()

const email    = ref('')
const password = ref('')
const error    = ref('')
const loading  = ref(false)

async function submit() {
  error.value = ''
  if (!email.value.trim() || !password.value.trim()) {
    error.value = 'メールアドレスとパスワードを入力してください'
    return
  }
  loading.value = true
  try {
    await login(email.value.trim(), password.value)
    router.push('/')
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'ログインに失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-950">
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/8 rounded-full blur-3xl" />
    </div>

    <div class="relative w-full max-w-sm px-4">
      <div class="flex flex-col items-center mb-10 gap-3">
        <ThreeBodyLogo class="scale-125" />
        <span class="text-white/80 font-semibold tracking-widest text-sm">ThreeBody</span>
      </div>

      <div class="bg-gray-900 border border-white/8 rounded-2xl p-8 shadow-2xl space-y-5">
        <h1 class="text-white/90 font-semibold text-base text-center">ログイン</h1>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">メールアドレス</label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder-white/20 px-4 py-2.5 outline-none focus:border-indigo-500/60 transition-colors"
            @keydown.enter="submit"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">パスワード</label>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder-white/20 px-4 py-2.5 outline-none focus:border-indigo-500/60 transition-colors"
            @keydown.enter="submit"
          />
        </div>

        <p v-if="error" class="text-xs text-rose-400/90 text-center bg-rose-500/8 border border-rose-500/15 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          class="w-full py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2"
          :class="loading
            ? 'bg-indigo-700/50 text-white/40 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'"
          :disabled="loading"
          @click="submit"
        >
          <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          {{ loading ? '認証中...' : 'ログイン' }}
        </button>

        <p class="text-center text-xs text-white/35">
          アカウントをお持ちでない方は
          <RouterLink to="/signup" class="text-indigo-400 hover:text-indigo-300 transition-colors">サインアップ</RouterLink>
        </p>
      </div>
    </div>
  </div>
</template>
