<script setup lang="ts">
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'
import { useTheme } from '../composables/useTheme'

// 未ログインの入口（/）。認証済みユーザーはここへ来る前に router のガードで
// /new へ流れるので、このコンポーネントは常に未ログイン状態でだけ描画される
// （router/index.ts の beforeEach を見よ）。
//
// ログイン前から開かれる点は LegalPage と同じなので、テーマ切替も同じ理由で持たせる
// （固定ダークの LoginView と違い、ここは長文を読ませる場所ではないが基準は揃える）
const { isDark, toggle } = useTheme()
</script>

<template>
  <div class="relative min-h-dvh bg-gray-50 dark:bg-gray-950 overflow-x-hidden">
    <!-- 装飾。新色は増やさず、既存のブランド色（indigo）だけで奥行きを作る -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] bg-indigo-600/10 dark:bg-indigo-500/10 rounded-full blur-3xl" />
      <div class="absolute top-40 -right-24 w-72 h-72 bg-indigo-400/10 dark:bg-indigo-400/8 rounded-full blur-3xl" />
    </div>

    <header class="sticky top-0 z-10 border-b border-black/8 dark:border-white/8 bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-md">
      <div class="max-w-3xl mx-auto flex items-center gap-3 px-5 py-3">
        <ThreeBodyLogo />
        <span class="text-gray-900 dark:text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>

        <button
          class="ml-auto w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer
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
      </div>
    </header>

    <main class="relative max-w-3xl mx-auto px-5 py-16 sm:py-20 space-y-16">
      <!-- ヒーロー -->
      <div class="flex flex-col items-center text-center gap-6">
        <div class="relative">
          <div class="absolute inset-0 rounded-full bg-indigo-500/25 blur-2xl scale-150" aria-hidden="true" />
          <!-- <ThreeBodyLogo class="relative scale-[2.75]" /> -->
        </div>
        <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
          ThreeBody へ ようこそ!!
        </h1>
        <p class="max-w-md text-sm sm:text-base leading-relaxed text-gray-600 dark:text-white/60">
          ThreeBody は、AI の答えをもう一度別の AI に確かめさせる音声チャットです。
          1つの問いに1つの答えが返り、その答えを最大2つの別モデルが検算します。
        </p>
        <router-link
          to="/login"
          class="group inline-flex items-center gap-2 text-sm font-semibold px-7 py-3 rounded-2xl transition-all duration-200 cursor-pointer
                 bg-indigo-600 hover:bg-indigo-500 text-white
                 shadow-lg shadow-indigo-600/25 hover:shadow-xl hover:shadow-indigo-600/35 hover:-translate-y-0.5"
        >
          はじめる
          <svg class="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </router-link>
      </div>

      <!-- できること -->
      <div class="space-y-4">
        <h2 class="text-center text-xs font-semibold tracking-widest uppercase text-gray-400 dark:text-white/30">ThreeBody でできること</h2>
        <div class="grid sm:grid-cols-2 gap-3">
          <div class="flex items-start gap-3 rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-4 transition-colors hover:border-indigo-500/30">
            <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"/>
                <path d="M19 11a7 7 0 01-14 0M12 19v3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="text-sm leading-relaxed text-gray-700 dark:text-white/70 pt-1">球体をタップして、声で問いかける</p>
          </div>

          <div class="flex items-start gap-3 rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-4 transition-colors hover:border-indigo-500/30">
            <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="text-sm leading-relaxed text-gray-700 dark:text-white/70 pt-1">答えのうち最も崩れやすい点を指摘してもらう</p>
          </div>

          <div class="flex items-start gap-3 rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-4 transition-colors hover:border-indigo-500/30">
            <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="9"/>
                <path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2 1.8-2 3.5M12 17h.01" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="text-sm leading-relaxed text-gray-700 dark:text-white/70 pt-1">答えのとおり進めたときに抜けている前提を指摘してもらう</p>
          </div>

          <div class="flex items-start gap-3 rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-4 transition-colors hover:border-indigo-500/30">
            <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" stroke-linecap="round"/>
              </svg>
            </div>
            <p class="text-sm leading-relaxed text-gray-700 dark:text-white/70 pt-1">おもしろかった問いを URL で渡し、相手の LLM でも走らせてもらう</p>
          </div>

          <div class="sm:col-span-2 flex items-start gap-3 rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-4 transition-colors hover:border-indigo-500/30">
            <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="9"/>
                <path d="M12 7v5l3 3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="text-sm leading-relaxed text-gray-700 dark:text-white/70 pt-1">会話を残し、あとから開き直す</p>
          </div>
        </div>
      </div>

      <!-- 始め方 -->
      <div class="rounded-2xl border border-indigo-500/20 bg-indigo-600/5 dark:bg-indigo-500/8 p-5 space-y-2">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">始め方</h2>
        <p class="text-sm leading-relaxed text-gray-600 dark:text-white/60">
          Google アカウントでログインすると、1日3回まで無料で試せます。
          続けて使うときは、設定画面に自分の API キーを入力してください。
        </p>
      </div>

      <!-- 補足 -->
      <div class="space-y-2">
        <div class="flex items-center gap-2 text-[10px] tracking-wide text-gray-400 dark:text-white/30">
          <span class="flex-1 border-t border-dashed border-black/10 dark:border-white/10" />
          補足
          <span class="flex-1 border-t border-dashed border-black/10 dark:border-white/10" />
        </div>
        <ul class="space-y-1 text-xs leading-relaxed text-gray-400 dark:text-white/35 list-disc pl-4">
          <li>検算は、答えが短いときや挨拶には付きません。</li>
          <li>検算の内容は主体の答えを書き換えません。別のカードとして並びます。</li>
          <li>名前は SF 小説『三体』から取っています。LLM を「体」と呼び、1体が答え、2体が検算します。</li>
        </ul>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-gray-400 dark:text-white/30 pt-2">
        <router-link to="/help" class="hover:text-gray-600 dark:hover:text-white/60">くわしい使い方</router-link>
        <span aria-hidden="true">·</span>
        <router-link to="/terms" class="hover:text-gray-600 dark:hover:text-white/60">利用規約</router-link>
        <span aria-hidden="true">·</span>
        <router-link to="/privacy" class="hover:text-gray-600 dark:hover:text-white/60">プライバシー</router-link>
      </div>
    </main>
  </div>
</template>
