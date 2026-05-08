<script setup lang="ts">
import { useTheme } from '../composables/useTheme'

const { isDark, toggle } = useTheme()
</script>

<template>
  <header class="flex items-center px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <h2 class="text-gray-500 dark:text-white/50 text-sm">新しい会話</h2>

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
  </header>
</template>
