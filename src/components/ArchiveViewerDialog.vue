<script setup lang="ts">
import { ref } from 'vue'
import type { Message } from '../types/message'
import { useChat } from '../composables/useChat'
import MessageBubble from './MessageBubble.vue'

const { loadArchivedMessages } = useChat()

const dialogRef = ref<HTMLDialogElement | null>(null)
const viewMessages = ref<Message[]>([])
const loading = ref(false)

async function open(sessionId: string) {
  dialogRef.value?.showModal()
  loading.value = true
  viewMessages.value = await loadArchivedMessages(sessionId)
  loading.value = false
}
function close() { dialogRef.value?.close() }

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[640px] max-h-[85vh] rounded-2xl p-0 shadow-2xl flex flex-col
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col h-full min-h-0">
        <header class="flex items-center justify-between px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">アーカイブ（読み取り専用）</h2>
          </div>
          <button
            class="transition-colors cursor-pointer text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/80"
            @click="close"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </header>

        <div class="flex-1 overflow-y-auto min-h-0">
          <div v-if="loading" class="flex items-center gap-3 px-6 py-8 text-sm text-gray-400 dark:text-white/40">
            <svg class="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" stroke-linecap="round"/>
            </svg>
            読み込んでいます...
          </div>
          <div v-else-if="viewMessages.length === 0" class="px-6 py-8 text-sm text-gray-400 dark:text-white/40 text-center">
            メッセージがありません
          </div>
          <template v-else>
            <MessageBubble
              v-for="msg in viewMessages"
              :key="msg.id"
              :message="msg"
              :readonly="true"
            />
          </template>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
