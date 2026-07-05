<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useTheme } from '../composables/useTheme'
import { useChat } from '../composables/useChat'

const { isDark, toggle } = useTheme()
const { currentSessionStartedAt, archiveCurrentSession } = useChat()

const menuOpen = ref(false)

const title = computed(() => {
  const d = currentSessionStartedAt.value
  if (!d) return '新しい会話'
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} の会話`
})

function closeMenu() { menuOpen.value = false }

async function handleArchive() {
  menuOpen.value = false
  await archiveCurrentSession()
}

onUnmounted(() => document.removeEventListener('click', closeMenu))
document.addEventListener('click', closeMenu)
</script>

<template>
  <header class="flex items-center px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <div class="relative">
      <button
        class="flex items-center gap-1.5 text-gray-500 dark:text-white/50 text-sm cursor-pointer hover:text-gray-700 dark:hover:text-white/70 transition-colors"
        @click.stop="menuOpen = !menuOpen"
      >
        <h2>{{ title }}</h2>
        <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div
        v-if="menuOpen"
        class="absolute left-0 top-full mt-1 w-40 rounded-xl shadow-lg p-3 z-10
               bg-white border border-black/8 dark:bg-gray-900 dark:border-white/10"
        @click.stop
      >
        <button
          class="flex items-center gap-1 w-full text-left px-3 py-2 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
          @click="handleArchive"
        >
          <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          アーカイブする
        </button>
      </div>
    </div>

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
