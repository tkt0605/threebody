<script setup lang="ts">
import { ref } from 'vue'
import { useChat } from '../composables/useChat'
import MessageList from './MessageList.vue'

const dialogRef = ref<HTMLDialogElement | null>(null)
const { messages, sendMessage } = useChat()
const input = ref('')

function open() { dialogRef.value?.showModal() }
function close() { dialogRef.value?.close() }

function submit() {
  const t = input.value.trim()
  if (!t) return
  sendMessage(t)
  input.value = ''
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[600px] h-[70vh] rounded-2xl p-0 shadow-2xl flex flex-col
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col h-full">
        <header class="flex items-center justify-between px-5 py-3.5 border-b shrink-0
                       border-black/8 dark:border-white/8">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-red-400" />
            <span class="text-sm font-medium text-gray-800 dark:text-white/80">Chat</span>
          </div>
          <button
            class="transition-colors cursor-pointer text-gray-400 hover:text-gray-700 dark:text-white/30 dark:hover:text-white/70"
            @click="close"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </header>
        <MessageList :messages="messages" />
        <div class="px-4 pb-4 pt-2 shrink-0">
          <div class="flex items-end gap-2 rounded-xl px-4 py-2.5 transition-colors
                      bg-gray-100 border border-black/8 focus-within:border-black/20
                      dark:bg-white/6 dark:border-white/8 dark:focus-within:border-white/20">
            <textarea
              v-model="input"
              rows="1"
              placeholder="メッセージを入力..."
              class="flex-1 resize-none bg-transparent text-sm outline-none max-h-24 leading-relaxed
                     text-gray-900 placeholder-black/30
                     dark:text-white/90 dark:placeholder-white/25"
              style="field-sizing: content"
              @keydown="onKey"
            />
            <button
              :disabled="!input.trim()"
              class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              :class="input.trim() ? 'bg-red-500 hover:bg-red-400 cursor-pointer' : 'bg-black/6 dark:bg-white/6 cursor-default'"
              @click="submit"
            >
              <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
