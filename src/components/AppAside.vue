<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ThreeBodyLogo from './ThreeBodyLogo.vue'
import SettingsDialog from './SettingsDialog.vue'
import { FEATURES, useTriangleNodes } from '../composables/useTriangleNodes'
import { useAuth } from '../composables/useAuth'
import { useTheme } from '../composables/useTheme'

const router = useRouter()
const route  = useRoute()
const { user, logout } = useAuth()
const { isDark } = useTheme()

const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null)

const building = ref(false)
const built = ref(false)
const hoveredId = ref<string | null>(null)

const { isPlaced } = useTriangleNodes()

async function handleLogout() {
  await logout()
  router.push('/login')
}

function build() {
  building.value = true
  built.value = false
  setTimeout(() => {
    building.value = false
    built.value = true
    setTimeout(() => { built.value = false }, 2000)
  }, 1200)
}

function onDragStart(e: DragEvent, id: string) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('featureId', id)
  e.dataTransfer.effectAllowed = 'copy'
}

const voiceBorderColor = computed(() =>
  isDark.value ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)'
)

function labelColor(placed: boolean, hovered: boolean): string {
  if (placed) return isDark.value ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'
  if (hovered) return isDark.value ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)'
  return isDark.value ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.65)'
}
</script>

<template>
  <aside class="flex flex-col w-60 h-screen border-r border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-5 py-2">
      <ThreeBodyLogo />
      <span class="text-gray-900 dark:text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>
    </div>

    <!-- Actions -->
    <div class="px-3 py-3 border-b border-black/8 dark:border-white/8 space-y-1.5">
      <!-- 設定変更 -->
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer
               text-gray-600 hover:text-gray-900 hover:bg-gray-200/70
               dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6"
        @click="settingsDialog?.open()"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        設定変更
      </button>

      <!-- ビルド -->
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer"
        :class="built
          ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400'
          : 'bg-indigo-600/20 text-indigo-600 hover:bg-indigo-600/30 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300'"
        :disabled="building"
        @click="build"
      >
        <svg v-if="building" class="w-4 h-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
        </svg>
        <svg v-else-if="built" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {{ building ? 'ビルド中...' : built ? '完了' : 'ビルド' }}
      </button>
    </div>

    <!-- Feature palette: drag to add to triangle -->
    <div class="px-3 py-3 border-b border-black/8 dark:border-white/8">
      <p class="text-[10px] text-gray-400 dark:text-white/25 uppercase tracking-widest mb-2 px-1">三体に追加</p>

      <!-- Voice: always at center, not draggable -->
      <div
        class="flex items-center gap-3 px-2 py-2 rounded-xl text-sm select-none cursor-default border-l-2 opacity-40"
        :style="{ borderLeftColor: voiceBorderColor }"
      >
        <div
          class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-black/8 dark:bg-white/8"
        >
          <svg class="w-3.5 h-3.5 text-gray-500 dark:text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="19" x2="12" y2="23" stroke-linecap="round"/>
            <line x1="8" y1="23" x2="16" y2="23" stroke-linecap="round"/>
          </svg>
        </div>
        <span class="text-gray-600 dark:text-white/55">Voice</span>
        <span class="ml-auto text-[10px] text-gray-400 dark:text-white/35">重心</span>
      </div>

      <!-- Draggable features -->
      <div
        v-for="feat in FEATURES"
        :key="feat.id"
        :draggable="!isPlaced(feat.id)"
        @dragstart="onDragStart($event, feat.id)"
        @mouseenter="!isPlaced(feat.id) && (hoveredId = feat.id)"
        @mouseleave="hoveredId = null"
        class="flex items-center gap-3 px-2 py-2 rounded-xl text-sm select-none transition-all duration-150 border-l-2"
        :class="isPlaced(feat.id) ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'"
        :style="{
          borderLeftColor: feat.color,
          background: (!isPlaced(feat.id) && hoveredId === feat.id) ? feat.color + '18' : 'transparent',
          opacity: isPlaced(feat.id) ? 0.45 : 1,
        }"
      >
        <!-- Icon badge -->
        <div
          class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150"
          :style="{
            background: feat.color + '22',
            boxShadow: hoveredId === feat.id && !isPlaced(feat.id) ? `0 0 10px ${feat.color}50` : 'none',
          }"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" :style="{ color: feat.color }">
            <path :d="feat.iconPath" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <span
          class="transition-colors duration-150"
          :style="{ color: labelColor(isPlaced(feat.id), hoveredId === feat.id) }"
        >{{ feat.name }}</span>

        <!-- drag handle (unplaced) -->
        <svg v-if="!isPlaced(feat.id)" class="ml-auto w-3 h-3 text-gray-300 dark:text-white/25" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
        <!-- checkmark (placed) -->
        <svg v-else class="ml-auto w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :style="{ color: feat.color }">
          <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- ナビゲーション -->
    <nav class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer"
        :class="route.path === '/'
          ? 'bg-indigo-600/15 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/70 dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6'"
        @click="router.push('/')"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        チャット
      </button>
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer"
        :class="route.path === '/aozora'
          ? 'bg-indigo-600/15 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/70 dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6'"
        @click="router.push('/recreate_film')"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        文庫作品
      </button>
    </nav>

    <!-- ユーザー情報 + ログアウト -->
    <div class="px-3 py-3 border-t border-black/8 dark:border-white/8">
      <div class="flex items-center gap-2.5 px-2 py-2 rounded-xl group">
        <!-- アバター -->
        <div class="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <span class="text-indigo-600 dark:text-indigo-300 text-xs font-semibold uppercase">{{ user?.email?.charAt(0) ?? '?' }}</span>
        </div>
        <!-- メール -->
        <span class="flex-1 text-xs text-gray-500 dark:text-white/45 truncate">{{ user?.email }}</span>
        <!-- ログアウト -->
        <button
          class="opacity-0 group-hover:opacity-100 transition-all cursor-pointer text-gray-400 hover:text-rose-500 dark:text-white/30 dark:hover:text-rose-400"
          title="ログアウト"
          @click="handleLogout"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="16 17 21 12 16 7" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  </aside>

  <SettingsDialog ref="settingsDialog" />
</template>
