<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ThreeBodyLogo from './ThreeBodyLogo.vue'
import SettingsDialog from './SettingsDialog.vue'
import DeleteAccountDialog from './DeleteAccountDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useAuth } from '../composables/useAuth'
import { useChat } from '../composables/useChat'
import { useAsideDrawer } from '../composables/useAsideDrawer'
defineProps<{ size?: number | string }>()
const router = useRouter()
const route  = useRoute()
const { user, logout } = useAuth()
const { conversations, currentConversationId, startNewConversation, deleteConversation, renameConversation } = useChat()
const { asideOpen, closeAside } = useAsideDrawer()

const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null)
const deleteAccountDialog = ref<InstanceType<typeof DeleteAccountDialog> | null>(null)
const confirmDeleteDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)

const displayName = computed(() =>
  user.value?.user_metadata?.full_name ?? user.value?.user_metadata?.name ?? user.value?.email ?? 'ゲスト'
)

function formatConversationLabel(conv: { title: string | null; createdAt: Date }): string {
  if (conv.title) return conv.title
  const d = conv.createdAt
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} の会話`
}

async function handleLogout() {
  console.log('Logging out...')
  userMenuOpen.value = false
  closeAside()
  await logout()
  router.push('/login')
  console.log('Logged out and redirected to login page')
}

function openSettings() {
  settingsDialog.value?.open()
  closeAside()
}

function selectConversation(id: string) {
  router.push(`/c/${id}`)
  closeAside()
}

function handleNewConversation() {
  startNewConversation()
  router.push('/new')
  closeAside()
}

async function handleDeleteConversation(id: string) {
  const wasCurrent = id === currentConversationId.value
  await deleteConversation(id)
  if (wasCurrent) router.push('/')
}

// 会話ごとの詳細メニュー（名前の変更／削除）。ゴミ箱アイコンが常時見えていると
// 押し間違いの導線になるため、詳細アイコンの奥に畳む
const menuOpenId = ref<string | null>(null)

function toggleConvMenu(id: string) {
  menuOpenId.value = menuOpenId.value === id ? null : id
}

function closeConvMenu() {
  menuOpenId.value = null
}

// タイトル編集は AppHeader と同じインライン入力パターン。編集対象は一度に1件のみ
const editingId = ref<string | null>(null)
const editTitleValue = ref('')
// v-for 内の ref は配列になる（同時に描画されるのは編集中の1件のみ）
const editInput = ref<HTMLInputElement[]>([])
// IME変換確定のEnterがkeyupまで漏れてくることがあるため、1回目のEnterでは確定せず
// 「もう一度押したら確定」の待ち状態に入るだけにする。入力があれば待ち状態は解除
const editEnterArmed = ref(false)

async function startRenameConversation(conv: { id: string; title: string | null }) {
  menuOpenId.value = null
  editingId.value = conv.id
  editTitleValue.value = conv.title ?? ''
  editEnterArmed.value = false
  await nextTick()
  editInput.value[0]?.focus()
  editInput.value[0]?.select()
}

async function saveRenameConversation() {
  const id = editingId.value
  if (!id) return
  editingId.value = null
  editEnterArmed.value = false
  await renameConversation(id, editTitleValue.value)
}

function cancelRenameConversation() {
  editingId.value = null
  editEnterArmed.value = false
}

function onRenameEnter() {
  if (editEnterArmed.value) { saveRenameConversation(); return }
  editEnterArmed.value = true
}

// 会話削除の確認。MessageBubble の孤立ターン削除と同じ ConfirmDialog を使い、
// 「取り消せない削除」の扱いをアプリ内で揃える
function requestDeleteConversation(conv: { id: string; title: string | null; createdAt: Date }) {
  menuOpenId.value = null
  confirmDeleteDialog.value?.open({
    title: 'この会話を削除',
    message: `「${formatConversationLabel(conv)}」を削除します。この操作は取り消せません。`,
    confirmLabel: '削除する',
    onConfirm: () => handleDeleteConversation(conv.id),
  })
}

function openDeleteAccount() {
  userMenuOpen.value = false
  closeAside()
  deleteAccountDialog.value?.open()
}

function closeUserMenuAndAside() {
  userMenuOpen.value = false
  closeAside()
}

// アカウント詳細メニュー（ログアウト・規約・プライバシー・退会）。会話の詳細メニューと
// 同じ「3点ドット→小さいダイアログ」の形に揃える（ROADMAP: 押し間違いを避ける導線の一貫性）
const userMenuOpen = ref(false)
function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
}
function closeUserMenu() {
  userMenuOpen.value = false
}

// 削除が完了した時点でセッションは消えている。ログイン画面へ戻さないと、
// 認証必須の画面に「消えたはずのユーザー」のまま留まることになる
function onAccountDeleted() {
  router.push('/login')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (menuOpenId.value) { closeConvMenu(); return }
  if (userMenuOpen.value) { closeUserMenu(); return }
  if (editingId.value) { cancelRenameConversation(); return }
  if (asideOpen.value) closeAside()
}
function closeMenus() {
  closeConvMenu()
  closeUserMenu()
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', closeMenus)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', closeMenus)
})

defineExpose({ openSettings })
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
    <div class="flex shrink-0 items-center gap-2.5 px-5 py-3 border-b border-black/8 dark:border-white/8">
      <ThreeBodyLogo />
      <span class="text-gray-900 dark:text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>
    </div>

    <!-- 新規会話・設定・使い方 -->
    <div class="px-3 py-3 shrink-0 border-b border-black/8 dark:border-white/8 space-y-1.5">
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer"
        :class="route.path === '/new' || route.path.startsWith('/c/')
          ? 'bg-indigo-600/12 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-600 hover:text-gray-900 hover:bg-black/5 dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6'"
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
      <router-link
        to="/details"
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer"
        :class="route.path === '/details'
          ? 'bg-indigo-600/12 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/70 dark:text-white/55 dark:hover:text-white/90 dark:hover:bg-white/6'"
        @click="closeAside"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 17v-5M12 8h.01" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        使い方
      </router-link>
    </div>

    <!-- ナビゲーション -->
    <nav class="flex-1 min-h-0 shrink-0 overflow-y-auto px-2 py-2 space-y-0.5">
    <!-- 会話一覧 -->
    <div class="px-2 py-2 shrink-0 space-y-0.5 min-h-0 overflow-y-auto">
      <div class="flex items-center justify-between px-3 pb-1">
        <p class="text-[10px] uppercase tracking-widest text-gray-400 dark:text-white/30">会話</p>
        <button
          class="text-gray-400 hover:text-indigo-500 dark:text-white/30 dark:hover:text-indigo-400 cursor-pointer"
          title="新規会話"
          @click="handleNewConversation"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div
        v-for="conv in conversations"
        :key="conv.id"
        class="relative w-full flex items-center gap-1 px-3 py-2 rounded-lg text-xs transition-colors"
        :class="conv.id === currentConversationId
          ? 'bg-indigo-600/12 text-indigo-600 dark:text-indigo-400'
          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 dark:text-white/45 dark:hover:text-white/80 dark:hover:bg-white/6'"
      >
        <input
          v-if="editingId === conv.id"
          ref="editInput"
          v-model="editTitleValue"
          class="flex-1 min-w-0 bg-transparent border-b border-indigo-400 outline-none text-gray-800 dark:text-white/90"
          @click.stop
          @input="editEnterArmed = false"
          @keyup.enter="onRenameEnter"
          @keyup.escape="cancelRenameConversation"
          @blur="saveRenameConversation"
        />
        <button
          v-else
          class="flex-1 min-w-0 text-left truncate cursor-pointer"
          @click="selectConversation(conv.id)"
        >{{ formatConversationLabel(conv) }}</button>

        <!-- 会話の詳細（名前の変更・削除）。ゴミ箱を常時出さず、ここに畳む -->
        <button
          v-if="editingId !== conv.id"
          class="shrink-0 text-gray-400 dark:text-white/30 hover:text-gray-700 dark:hover:text-white/70 cursor-pointer p-0.5 rounded"
          title="会話の詳細"
          aria-label="会話の詳細"
          @click.stop="toggleConvMenu(conv.id)"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6"/>
            <circle cx="12" cy="12" r="1.6"/>
            <circle cx="12" cy="19" r="1.6"/>
          </svg>
        </button>

        <div
          v-if="menuOpenId === conv.id"
          class="absolute right-0 top-full mt-1 w-32 rounded-xl shadow-lg p-1.5 z-10
                 bg-white border border-black/8 dark:bg-gray-900 dark:border-white/10"
          @click.stop
        >
          <button
            class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
            @click="startRenameConversation(conv)"
          >
            <svg class="w-3 h-3" width="16" height="16"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            名前を変更
          </button>
          <button
            class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10 dark:text-rose-400 cursor-pointer"
            @click="requestDeleteConversation(conv)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
            </svg>
            削除
          </button>
        </div>
      </div>
    </div>
    </nav>
    <!-- ユーザー -->
    <div class="px-2 py-4 border-t border-black/8 dark:border-white/8 shrink-0">
      <div class="relative flex items-center gap-2 px-3 py-2 rounded-xl">
        <div class="w-6 h-6 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <span class="text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold uppercase">{{ displayName.charAt(0) }}</span>
        </div>
        <span class="flex-1 text-xs text-gray-400 dark:text-white/35 truncate">{{ displayName }}</span>

        <!-- アカウントの詳細（ログアウト・規約・プライバシー・退会）。会話の詳細メニューと
             同じく、常時出さずここに畳む -->
        <button
          class="shrink-0 text-gray-400 dark:text-white/30 hover:text-gray-700 dark:hover:text-white/70 cursor-pointer p-0.5 rounded"
          title="アカウントの詳細"
          aria-label="アカウントの詳細"
          @click.stop="toggleUserMenu"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6"/>
            <circle cx="12" cy="12" r="1.6"/>
            <circle cx="12" cy="19" r="1.6"/>
          </svg>
        </button>

        <!-- サイドバー最下段のため、会話メニュー（下に開く）と違い上に開く -->
        <div
          v-if="userMenuOpen"
          class="absolute right-0 bottom-full mb-1 w-40 rounded-xl shadow-lg p-1.5 z-10
                 bg-white border border-black/8 dark:bg-gray-900 dark:border-white/10"
          @click.stop
        >
          <button
            class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
            @click="handleLogout"
          >
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="16 17 21 12 16 7" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="21" y1="12" x2="9" y2="12" stroke-linecap="round"/>
            </svg>
            ログアウト
          </button>
          <router-link
            to="/terms"
            class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
            @click="closeUserMenuAndAside"
          >
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="14 2 14 8 20 8" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="8" y1="13" x2="16" y2="13" stroke-linecap="round"/>
              <line x1="8" y1="17" x2="16" y2="17" stroke-linecap="round"/>
            </svg>
            利用規約
          </router-link>
          <router-link
            to="/privacy"
            class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/6 cursor-pointer"
            @click="closeUserMenuAndAside"
          >
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            プライバシー
          </router-link>
          <button
            class="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10 dark:text-rose-400 cursor-pointer"
            @click="openDeleteAccount"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="shrink-0" viewBox="0 0 16 16">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
            </svg>
            アカウントを削除
          </button>
        </div>
      </div>
    </div>
  </aside>
  </Teleport>

  <SettingsDialog ref="settingsDialog" />
  <DeleteAccountDialog ref="deleteAccountDialog" @deleted="onAccountDeleted" />
  <ConfirmDialog ref="confirmDeleteDialog" />
</template>

<style scoped>
.aside-backdrop-enter-active, .aside-backdrop-leave-active { transition: opacity 0.2s ease; }
.aside-backdrop-enter-from, .aside-backdrop-leave-to { opacity: 0; }
</style>
