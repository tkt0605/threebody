<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ThreeBodyLogo from './ThreeBodyLogo.vue'
import SettingsDialog from './SettingsDialog.vue'
import ArchiveViewerDialog from './ArchiveViewerDialog.vue'
import { useAuth } from '../composables/useAuth'
import { useChat } from '../composables/useChat'
import { useAsideDrawer } from '../composables/useAsideDrawer'

const router = useRouter()
const route  = useRoute()
const { user, logout } = useAuth()
const { archivedSessions, deleteArchive } = useChat()
const { asideOpen, closeAside } = useAsideDrawer()

const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null)
const archiveViewer  = ref<InstanceType<typeof ArchiveViewerDialog> | null>(null)

const displayName = computed(() =>
  user.value?.user_metadata?.full_name ?? user.value?.user_metadata?.name ?? user.value?.email ?? 'ゲスト'
)

function formatArchiveLabel(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

const building = ref(false)
const built    = ref(false)

async function handleLogout() {
  console.log('Logging out...')
  closeAside()
  await logout()
  router.push('/login')
  console.log('Logged out and redirected to login page')
}

function build() {
  building.value = true
  built.value    = false
  setTimeout(() => {
    building.value = false
    built.value    = true
    setTimeout(() => { built.value = false }, 2000)
  }, 1200)
}

function goChat() {
  router.push('/')
  closeAside()
}

function openSettings() {
  settingsDialog.value?.open()
  closeAside()
}

function openArchive(sessionId: string) {
  archiveViewer.value?.open(sessionId)
  closeAside()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && asideOpen.value) closeAside()
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition name="aside-backdrop">
      <div
        v-if="asideOpen"
        class="fixed inset-0 bg-black/50 z-40"
        @click="closeAside"
      />
    </Transition>

    <aside
      class="fixed inset-y-0 left-0 z-50 flex flex-col w-64 max-w-[85vw] border-r border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950
             transition-transform duration-200 ease-out"
      :class="asideOpen ? 'translate-x-0' : '-translate-x-full'"
    >
    <!-- ロゴ -->
    <div class="flex items-center gap-2.5 px-5 py-3 border-b border-black/8 dark:border-white/8">
      <ThreeBodyLogo />
      <span class="text-gray-900 dark:text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>
    </div>

    <!-- 設定 + ビルド -->
    <div class="px-3 py-3 border-b border-black/8 dark:border-white/8 space-y-1.5">
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer
               text-gray-600 hover:text-gray-900 hover:bg-gray-200/70
               dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6"
        @click="openSettings"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        設定
      </button>

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
    <!-- アーカイブ一覧 -->
    <div v-if="archivedSessions.length > 0" class="px-2 py-2 border-b border-black/8 dark:border-white/8 space-y-0.5 max-h-40 overflow-y-auto">
      <p class="px-3 pb-1 text-[10px] uppercase tracking-widest text-gray-400 dark:text-white/30">アーカイブ</p>
      <button
        v-for="session in archivedSessions"
        :key="session.id"
        class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer
               text-gray-500 hover:text-gray-800 hover:bg-gray-200/70
               dark:text-white/45 dark:hover:text-white/80 dark:hover:bg-white/6"
        @click="openArchive(session.id)"
      >
        <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="truncate">{{ formatArchiveLabel(session.startedAt) }} の会話</span>
        <!-- アーカイブの削除 -->
        <span class="ml-auto text-gray-400 dark:text-white/30 hover:text-rose-500 dark:hover:text-rose-400" @click.stop="deleteArchive(session.id)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
          </svg>
        </span>
      </button>
    </div>

    <!-- ナビゲーション -->
    <nav class="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer"
        :class="route.path === '/'
          ? 'bg-indigo-600/12 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-600 hover:text-gray-900 hover:bg-black/5 dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6'"
        @click="goChat"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        チャット
      </button>

    </nav>

    <!-- ユーザー -->
    <div class="px-2 py-4 border-t border-black/8 dark:border-white/8">
      <!-- ユーザー -->
      <div class="flex items-center gap-2 px-3 py-2 rounded-xl group">
        <div class="w-6 h-6 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <span class="text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold uppercase">{{ displayName.charAt(0) }}</span>
        </div>
        <span class="flex-1 text-xs text-gray-400 dark:text-white/35 truncate">{{ displayName }}</span>
        <button
          class="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all cursor-pointer text-gray-400 hover:text-rose-500 dark:text-white/25 dark:hover:text-rose-400"
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
  </Teleport>

  <SettingsDialog ref="settingsDialog" />
  <ArchiveViewerDialog ref="archiveViewer" />
</template>

<style scoped>
.aside-backdrop-enter-active, .aside-backdrop-leave-active { transition: opacity 0.2s ease; }
.aside-backdrop-enter-from, .aside-backdrop-leave-to { opacity: 0; }
</style>
