<script setup lang="ts">
import { ref } from 'vue'
import { useSettings } from '../composables/useSettings'

const dialogRef = ref<HTMLDialogElement | null>(null)
const { settings } = useSettings()

function open() { dialogRef.value?.showModal() }
function close() { dialogRef.value?.close() }

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[480px] rounded-2xl p-0 shadow-2xl
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col">
        <header class="flex items-center justify-between px-5 py-3.5 border-b border-black/8 dark:border-white/8">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-400" />
            <span class="text-sm font-medium text-gray-800 dark:text-white/80">コンテキスト</span>
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
        <div class="px-5 py-5 space-y-4">
          <p class="text-xs leading-relaxed text-gray-400 dark:text-white/35">
            AIの根本的な振る舞いや背景情報を定義します。ここに入力した内容がシステム全体の基盤となります。
          </p>
          <textarea
            v-model="settings.systemPrompt"
            rows="8"
            placeholder="例：あなたは三体問題を探求するAIアシスタントです..."
            class="w-full rounded-xl text-sm px-4 py-3 outline-none resize-none leading-relaxed transition-colors
                   bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-blue-500/40
                   dark:bg-white/5 dark:border-white/8 dark:text-white/90 dark:placeholder-white/20 dark:focus:border-blue-500/40"
          />
          <div class="flex justify-end">
            <button
              class="px-4 py-2 rounded-xl text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
              @click="close"
            >保存して閉じる</button>
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
