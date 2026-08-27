<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'
import { useAuth } from '../composables/useAuth'
import { useTheme } from '../composables/useTheme'
import { rememberPostLogin } from '../lib/postLogin'

const { loginWithGoogle } = useAuth()
// 既定はライト、他ページ（LegalPage 等）と同じ isDark singleton をそのまま使う。
// 以前は bg-gray-950 を固定で敷いていたため、設定がライトでもここだけ常時ダークだった
const { isDark, toggle } = useTheme()
const route  = useRoute()
const router = useRouter()

const error   = ref('')
const loading = ref(false)

// /auth/callback でのトークン交換失敗はここまで戻ってくる（AuthCallback.vue）。
// クエリは一度表示したら消す。残したままリロードされると、直っていないように見える
onMounted(() => {
  if (route.query.authError) {
    error.value = 'ログインに失敗しました。もう一度お試しください。'
    router.replace({ path: '/login' })
  }
})

async function onGoogleLogin() {
  if (loading.value) return
  error.value   = ''
  loading.value = true
  try {
    // 行き先はブラウザに預けてから出る。Google から戻る先は固定で、途中の意図を運べない
    const next = route.query.next
    if (typeof next === 'string') rememberPostLogin(next)
    // 成功時は Google にリダイレクトするためここには戻らない
    await loginWithGoogle()
  } catch (err) {
    error.value   = err instanceof Error ? err.message : 'ログインに失敗しました'
    loading.value = false
  }
}
</script>

<template>
  <div class="relative flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <!-- 新色は増やさず、既存のブランド色（indigo）だけで奥行きを作る -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-indigo-600/10 dark:bg-indigo-500/10 rounded-full blur-3xl" />
      <div class="absolute bottom-0 -right-24 w-72 h-72 bg-indigo-400/10 dark:bg-indigo-400/8 rounded-full blur-3xl" />
    </div>

    <button
      class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer
             text-gray-400 hover:text-gray-700 hover:bg-gray-200/60
             dark:text-white/40 dark:hover:text-white/80 dark:hover:bg-white/8"
      :title="isDark ? 'ライトモードに切替' : 'ダークモードに切替'"
      @click="toggle"
    >
      <svg v-if="isDark" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke-linecap="round"/>
      </svg>
      <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div class="relative w-full max-w-sm px-4">
      <div class="flex items-center justify-center mb-10 gap-3">
        <div class="relative">
          <div class="absolute inset-0 rounded-full bg-indigo-500/25 blur-2xl scale-150" aria-hidden="true" />
          <ThreeBodyLogo class="relative scale-150" />
        </div>
        <span class="text-gray-900 dark:text-white/80 font-semibold tracking-widest text-xl">ThreeBody</span>
      </div>

      <div class="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-black/8 dark:border-white/8 rounded-2xl p-8 shadow-2xl shadow-indigo-600/10 dark:shadow-black/40 space-y-6">
        <div class="text-center space-y-1.5">
          <h1 class="text-gray-900 dark:text-white/90 font-semibold text-base">ログイン</h1>
          <p class="text-xs text-gray-400 dark:text-white/35">Google アカウントで続行</p>
        </div>

        <p v-if="error" class="text-xs text-rose-500 dark:text-rose-400/90 text-center bg-rose-500/8 border border-rose-500/15 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          class="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-3
                 border border-black/8 dark:border-white/8"
          :class="loading
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-white/40 cursor-not-allowed'
            : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md hover:-translate-y-0.5 cursor-pointer'"
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
        <p class="text-center text-[11px] text-gray-400 dark:text-white/30 leading-relaxed">
          続行すると<router-link to="/terms" class="text-gray-600 dark:text-white/55 underline underline-offset-2 hover:text-gray-800 dark:hover:text-white/80">利用規約</router-link>および<router-link to="/privacy" class="text-gray-600 dark:text-white/55 underline underline-offset-2 hover:text-gray-800 dark:hover:text-white/80">プライバシーポリシー</router-link>に同意したものとみなされます。  
          詳しい使い方は
          <router-link to="/help" class="text-[11px] text-gray-400 dark:text-white/35 underline underline-offset-2 hover:text-gray-600 dark:hover:text-white/60">こちら</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
