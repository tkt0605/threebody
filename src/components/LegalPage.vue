<script setup lang="ts">
import { useRouter } from 'vue-router'
import ThreeBodyLogo from './ThreeBodyLogo.vue'
import { useTheme } from '../composables/useTheme'
import { LEGAL_EFFECTIVE_DATE } from '../constants/legal'

// 利用規約とプライバシーポリシーで共通の枠（見出し・戻る導線・本文の体裁）。
// 中身だけがスロットで差し替わる。
//
// ログイン前（/login から）とログイン後（サイドバーから）の両方から開かれるため、
// 「戻る」は固定リンクではなく履歴を1つ戻す。履歴が無い場合（URL直打ち・
// 検索流入・Google の審査画面からの遷移）だけ /login へ落とす
defineProps<{ title: string }>()

const router = useRouter()

// このページには AppHeader が無く、ログイン前（LoginView は常時ダーク配色）からも
// 開かれる。切替手段が無いと、明暗が飛んだまま長い条文を読ませることになるため、
// ヘッダに AppHeader と同じトグルを持たせる（状態は useTheme の singleton で共通）
const { isDark, toggle } = useTheme()

function goBack() {
  if (window.history.state?.back) router.back()
  else router.push('/login')
}
</script>

<template>
  <div class="min-h-dvh bg-gray-50 dark:bg-gray-950">
    <header class="sticky top-0 z-10 border-b border-black/8 dark:border-white/8 bg-gray-50/90 dark:bg-gray-950/90 backdrop-blur">
      <div class="max-w-3xl mx-auto flex items-center gap-3 px-5 py-3">
        <button
          class="shrink-0 p-1.5 -ml-1.5 rounded-lg cursor-pointer transition-colors
                 text-gray-500 hover:bg-gray-200/70 dark:text-white/50 dark:hover:bg-white/8"
          title="戻る"
          aria-label="戻る"
          @click="goBack"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <ThreeBodyLogo />
        <span class="text-gray-900 dark:text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>

        <button
          class="ml-auto w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer
                 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60
                 dark:text-white/40 dark:hover:text-white/80 dark:hover:bg-white/8"
          :title="isDark ? 'ライトモードに切替' : 'ダークモードに切替'"
          @click="toggle"
        >
          <!-- 太陽：ダーク時に表示 -->
          <svg v-if="isDark" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke-linecap="round"/>
          </svg>
          <!-- 月：ライト時に表示 -->
          <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-5 py-10 legal">
      <h1 class="text-xl font-semibold text-gray-900 dark:text-white/90">{{ title }}</h1>
      <p class="mt-1 text-xs text-gray-400 dark:text-white/30">最終改定日: {{ LEGAL_EFFECTIVE_DATE }}</p>
      <div class="mt-8 space-y-8">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 条文は数が多く、1項目ずつユーティリティクラスを振ると差分が読めなくなるため、
   このページの中だけで効く体裁をここへまとめる。
   ダークは html.dark を見るクラス方式（src/style.css の @variant dark）に合わせ、
   scoped の属性セレクタをすり抜けるよう :global(.dark) を前置する */
.legal :deep(h2) {
  font-size: 0.875rem;
  font-weight: 600;
  color: #111827;
}
.legal :deep(p) {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.75rem;
  color: #4b5563;
}
.legal :deep(ul) {
  margin-top: 0.5rem;
  padding-left: 1.25rem;
  list-style: disc;
  font-size: 0.875rem;
  line-height: 1.75rem;
  color: #4b5563;
}
.legal :deep(a) {
  color: #4f46e5;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.legal :deep(table) {
  margin-top: 0.75rem;
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  text-align: left;
}
.legal :deep(th),
.legal :deep(td) {
  border: 1px solid rgba(0, 0, 0, 0.08);
  padding: 0.5rem 0.75rem;
  vertical-align: top;
  color: #4b5563;
}
.legal :deep(th) {
  font-weight: 500;
  color: #1f2937;
  background: rgba(0, 0, 0, 0.03);
}

/* 【:global() を使わないこと】`:global(.dark) .legal :deep(h2)` と書くと、この
   ブロックがコンパイル結果から丸ごと消える（ライトの色だけが残り、ダークで
   本文が黒いまま読めなくなる）。scoped は「:deep より前の最後のセレクタ」に
   data-v 属性を付けるだけなので、.dark を素で前置すれば
   `.dark .legal[data-v-x] h2` に展開され、意図どおりになる */
.dark .legal :deep(h2)  { color: rgba(255, 255, 255, 0.85); }
.dark .legal :deep(p),
.dark .legal :deep(ul),
.dark .legal :deep(td),
.dark .legal :deep(th)  { color: rgba(255, 255, 255, 0.6); }
.dark .legal :deep(a)   { color: #818cf8; }
.dark .legal :deep(th),
.dark .legal :deep(td)  { border-color: rgba(255, 255, 255, 0.1); }
.dark .legal :deep(th)  { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.05); }
</style>
