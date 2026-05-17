<script setup lang="ts">
import { ref } from 'vue'
import McpDialog from './McpDialog.vue'
import ContextDialog from './ContextDialog.vue'

const props = defineProps<{
  recording: boolean
  input: string
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  'toggle-mic': []
  'open-mcp': []
  'open-context': []
}>()

const mcpRef = ref<InstanceType<typeof McpDialog> | null>(null)
const ctxRef = ref<InstanceType<typeof ContextDialog> | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <aside class="flex flex-col w-72 h-screen border-l border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <!-- ヘッダー -->
    <div class="flex items-center gap-2 px-5 py-5.5 border-b border-black/8 dark:border-white/8">
      <svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="text-sm font-semibold text-gray-900 dark:text-white/90">プロンプト入力</span>
    </div>

    <!-- 入力エリア -->
    <div class="flex flex-col flex-1 px-3 py-4 gap-3">
      <!-- テキストエリア -->
      <div
        class="flex flex-col gap-2 rounded-2xl border px-4 py-3 transition-colors
               bg-white border-black/10 focus-within:border-indigo-400/60
               dark:bg-white/5 dark:border-white/10 dark:focus-within:border-indigo-400/40"
      >
        <textarea
          :value="input"
          rows="3"
          placeholder="メッセージを入力..."
          class="w-full resize-none bg-transparent text-sm outline-none leading-relaxed
                 text-gray-900 placeholder-black/30
                 dark:text-white/90 dark:placeholder-white/25"
          @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)"
          @keydown="onKeydown"
        />

        <!-- ツールバー -->
        <div class="flex items-center justify-between pt-1 border-t border-black/6 dark:border-white/6">
          <div class="flex items-center gap-1">
            <!-- MCP -->
            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     dark:text-white/30 dark:hover:text-white/70 dark:hover:bg-white/8"
              title="MCPサーバー"
              @click="mcpRef?.open()"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- コンテキスト -->
            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     dark:text-white/30 dark:hover:text-white/70 dark:hover:bg-white/8"
              title="コンテキストを追加"
              @click="ctxRef?.open()"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- マイク -->
            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer"
              :class="recording
                ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-white/30 dark:hover:text-white/70 dark:hover:bg-white/8'"
              title="音声入力"
              @click="emit('toggle-mic')"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="9" y="2" width="6" height="13" rx="3"/>
                <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- 送信 -->
          <button
            :disabled="!input.trim()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
            :class="input.trim()
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
              : 'bg-black/6 dark:bg-white/6 text-gray-400 dark:text-white/25 cursor-default'"
            @click="emit('submit')"
          >
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            送信
          </button>
        </div>
      </div>

      <!-- ショートカットヒント -->
      <p class="text-[11px] text-gray-400 dark:text-white/25 px-1">
        <kbd class="font-mono">Enter</kbd> で送信　<kbd class="font-mono">Shift+Enter</kbd> で改行
      </p>
    </div>
  </aside>

  <McpDialog ref="mcpRef" />
  <ContextDialog ref="ctxRef" />
</template>
