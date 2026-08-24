<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { takePostLogin } from '../lib/postLogin'

const router = useRouter()

onMounted(async () => {
  // PKCE: URLの ?code= をトークンと交換する。
  // exchangeCodeForSession() は code の値そのものを要求する（URL全体を渡すと常に失敗する）
  const code = new URL(window.location.href).searchParams.get('code') ?? ''
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  // 失敗時（例: ログアウト直後の再ログインでcode_verifierが競合するPKCEエラー）は
  // takePostLogin() を呼ばない＝sessionStorageの行き先は消費せずに残す。
  // 同じタブでもう一度ログインし直せば、その時に拾い直せる
  const dest = error ? { path: '/login', query: { authError: '1' } } : (takePostLogin() ?? '/new')
  router.replace(dest)
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-950">
    <svg class="w-6 h-6 text-indigo-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
    </svg>
  </div>
</template>
