<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'

const router = useRouter()
const { signup } = useAuth()

const email           = ref('')
const password        = ref('')
const passwordConfirm = ref('')
const error           = ref('')
const loading         = ref(false)
const needsConfirm    = ref(false)

async function submit() {
  error.value = ''
  if (!email.value.trim() || !password.value.trim()) {
    error.value = 'メールアドレスとパスワードを入力してください'
    return
  }
  if (password.value !== passwordConfirm.value) {
    error.value = 'パスワードが一致しません'
    return
  }
  if (password.value.length < 6) {
    error.value = 'パスワードは6文字以上で入力してください'
    return
  }
  loading.value = true
  try {
    const { needsConfirmation } = await signup(email.value.trim(), password.value)
    if (needsConfirmation) {
      needsConfirm.value = true
    } else {
      router.push('/')
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'サインアップに失敗しました'
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

      <!-- メール確認待ち -->
      <div v-if="needsConfirm" class="bg-gray-900 border border-white/8 rounded-2xl p-8 shadow-2xl text-center space-y-4">
        <div class="w-12 h-12 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto">
          <svg class="w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="22,6 12,13 2,6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h2 class="text-white/90 font-semibold">メールを確認してください</h2>
        <p class="text-sm text-white/45 leading-relaxed">
          <span class="text-white/70">{{ email }}</span> に確認リンクを送信しました。<br>
          メールのリンクをクリックしてアカウントを有効化してください。
        </p>
        <RouterLink to="/login" class="block mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          ログインページへ戻る
        </RouterLink>
      </div>

      <!-- サインアップフォーム -->
      <div v-else class="bg-gray-900 border border-white/8 rounded-2xl p-8 shadow-2xl space-y-5">
        <h1 class="text-white/90 font-semibold text-base text-center">アカウント作成</h1>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">メールアドレス</label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder-white/20 px-4 py-2.5 outline-none focus:border-indigo-500/60 transition-colors"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">パスワード</label>
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            placeholder="6文字以上"
            class="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder-white/20 px-4 py-2.5 outline-none focus:border-indigo-500/60 transition-colors"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">パスワード確認</label>
          <input
            v-model="passwordConfirm"
            type="password"
            autocomplete="new-password"
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
          {{ loading ? '作成中...' : 'アカウントを作成' }}
        </button>

        <p class="text-center text-xs text-white/35">
          すでにアカウントをお持ちの方は
          <RouterLink to="/login" class="text-indigo-400 hover:text-indigo-300 transition-colors">ログイン</RouterLink>
        </p>
      </div>
    </div>
  </div>
</template>
