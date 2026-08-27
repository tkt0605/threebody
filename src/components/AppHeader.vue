<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { useChat } from '../composables/useChat'
import { useAsideDrawer } from '../composables/useAsideDrawer'
import ConfirmDialog from './ConfirmDialog.vue'
defineProps<{ size?: number | string }>()
const router = useRouter()
const { isDark, toggle } = useTheme()
const { currentConversation, startNewConversation, renameConversation, deleteConversation } = useChat()
const { toggleAside } = useAsideDrawer()

const menuOpen = ref(false)

const title = computed(() => {
  const conv = currentConversation.value
  if (!conv) return '新しい会話'
  if (conv.title) return conv.title
  const d = conv.createdAt
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} の会話`
})

function closeMenu() { menuOpen.value = false }

function handleNewConversation() {
  menuOpen.value = false
  startNewConversation()
  router.push('/new')
}

const editingTitle = ref(false)
const editTitleValue = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
// IME変換確定のEnterがkeyupまで漏れてくることがあるため、1回目のEnterでは確定せず
// 「もう一度押したら確定」の待ち状態に入るだけにする。入力があれば待ち状態は解除
const titleEnterArmed = ref(false)

async function startEditTitle() {
  menuOpen.value = false
  editTitleValue.value = currentConversation.value?.title ?? ''
  editingTitle.value = true
  titleEnterArmed.value = false
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

async function saveTitle() {
  if (!editingTitle.value) return
  editingTitle.value = false
  titleEnterArmed.value = false
  const id = currentConversation.value?.id
  if (id) await renameConversation(id, editTitleValue.value)
}

function cancelEditTitle() {
  editingTitle.value = false
  titleEnterArmed.value = false
}

function onTitleEnter() {
  if (titleEnterArmed.value) { saveTitle(); return }
  titleEnterArmed.value = true
}

// 会話削除は取り消せない。AppAside・MessageBubble と同じ ConfirmDialog で確認を挟む
const confirmDeleteDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)

function requestDeleteConversation() {
  menuOpen.value = false
  const conv = currentConversation.value
  if (!conv) return
  confirmDeleteDialog.value?.open({
    title: 'この会話を削除',
    message: `「${title.value}」を削除します。この操作は取り消せません。`,
    confirmLabel: '削除する',
    onConfirm: async () => {
      await deleteConversation(conv.id)
      router.push('/new')
    },
  })
}

onUnmounted(() => document.removeEventListener('click', closeMenu))
document.addEventListener('click', closeMenu)
</script>

<template>
  <header class="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <!-- ハンバーガーメニュー：Aside（ドロワー）の開閉 -->
    <button
      class="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer
             text-gray-500 hover:text-gray-800 hover:bg-gray-200/60
             dark:text-white/50 dark:hover:text-white/90 dark:hover:bg-white/8"
      title="メニュー"
      aria-label="メニューを開く"
      @click.stop="toggleAside"
    >
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/>
      </svg>
    </button>

    <div class="relative flex items-center gap-1">
      <button
        v-if="!editingTitle"
        class="flex items-center gap-1.5 text-gray-500 dark:text-white/50 text-sm cursor-pointer hover:text-gray-700 dark:hover:text-white/70 transition-colors"
        @click.stop="menuOpen = !menuOpen"
      >
        <h2>{{ title }}</h2>
        <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <input
        v-else
        ref="titleInput"
        v-model="editTitleValue"
        class="text-sm bg-transparent border-b border-indigo-400 outline-none text-gray-800 dark:text-white/90 w-40"
        @click.stop
        @input="titleEnterArmed = false"
        @keyup.enter="onTitleEnter"
        @keyup.escape="cancelEditTitle"
        @blur="saveTitle"
      />
      <div
        v-if="menuOpen"
        class="absolute left-0 top-full mt-1 w-40 rounded-xl shadow-lg p-3 z-10
               bg-white border border-black/8 dark:bg-gray-900 dark:border-white/10"
        @click.stop
      >
        <button
          class="flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
          @click="handleNewConversation"
        >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 7V5a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-1" />
          <path d="M6 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-4l-4 3.5V18a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />
          <path d="M10 10v5M7.5 12.5h5" />
        </svg>
          新規会話
        </button> 
        <button
          v-if="!editingTitle && currentConversation"
          class="flex items-center gap-3  w-full text-left px-3 py-2 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
          title="タイトルを編集"
          aria-label="タイトルを編集"
          @click.stop="startEditTitle"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          名前を変更
        </button>
        <button
          v-if="currentConversation"
          class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10 dark:text-rose-400 cursor-pointer"
          @click="requestDeleteConversation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
          </svg>
          削除
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

  <ConfirmDialog ref="confirmDeleteDialog" />
</template>
