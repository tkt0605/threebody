<script setup lang="ts">
import { ref } from 'vue'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'
import { useAuth } from '../composables/useAuth'

const { loginWithGoogle } = useAuth()

const error   = ref('')
const loading = ref(false)

async function onGoogleLogin() {
  if (loading.value) return
  error.value   = ''
  loading.value = true
  try {
    // 成功時は Google にリダイレクトするためここには戻らない
    await loginWithGoogle()
  } catch (err) {
    error.value   = err instanceof Error ? err.message : 'ログインに失敗しました'
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
        <span class="text-white/80 font-semibold tracking-widest text-xl">ThreeBody</span>
      </div>

      <div class="bg-gray-900 border border-white/8 rounded-2xl p-8 shadow-2xl space-y-6">
        <div class="text-center space-y-1.5">
          <h1 class="text-white/90 font-semibold text-base">ログイン</h1>
          <p class="text-xs text-white/35">Google アカウントで続行</p>
        </div>

        <p v-if="error" class="text-xs text-rose-400/90 text-center bg-rose-500/8 border border-rose-500/15 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          class="w-full py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-3"
          :class="loading
            ? 'bg-white/10 dark:bg-gray-800 text-white/40 cursor-not-allowed'
            : 'bg-white dark:bg-gray-800 text-gray-800 hover:bg-white/90 cursor-pointer'"
          :disabled="loading"
          @click="onGoogleLogin"
        >
          <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          <svg v-else class="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
            <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"/>
          </svg>
          {{ loading ? 'リダイレクト中...' : 'Google で続行' }}
        </button>

        <!-- 同意を求める以上、その場で全文を読めなければ同意は成立しない。
             リンク先は requiresAuth 無しのため、ログインせずに開ける -->
        <p class="text-center text-[11px] text-white/30 leading-relaxed">
          続行すると<router-link to="/terms" class="text-white/55 underline underline-offset-2 hover:text-white/80">利用規約</router-link>および<router-link to="/privacy" class="text-white/55 underline underline-offset-2 hover:text-white/80">プライバシーポリシー</router-link>に同意したものとみなされます。
        </p>
      </div>
    </div>
  </div>
</template>
