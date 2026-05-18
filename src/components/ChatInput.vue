<script setup lang="ts">
import { ref, watch } from 'vue'
import { useVoiceInput } from '../composables/useVoiceInput'

const emit = defineEmits<{ send: [text: string] }>()

const input = ref('')

const { recording, finalText, interimText, errorMsg, start, stop, cancel } =
  useVoiceInput((text) => { input.value = text })

// 録音中はリアルタイムでテキストエリアに流し込む
watch([finalText, interimText], () => {
  if (recording.value) {
    input.value = finalText.value + interimText.value
  }
})

function submit() {
  const text = input.value.trim()
  if (!text) return
  if (recording.value) cancel()
  emit('send', text)
  input.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="px-4 pb-6 pt-2">
    <!-- エラー表示 -->
    <p v-if="errorMsg" class="text-rose-400 text-xs mb-1 px-1">{{ errorMsg }}</p>

    <div
      class="flex items-end gap-2 rounded-2xl bg-white/8 backdrop-blur-sm border px-4 py-3 transition-colors"
      :class="recording
        ? 'border-rose-500/50'
        : 'border-white/10 focus-within:border-white/25'"
    >
      <div class="flex-1 flex flex-col gap-1 min-w-0">
        <!-- 録音中インジケーター -->
        <div v-if="recording" class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <span class="text-xs text-rose-400/80 tracking-wide">録音中</span>
        </div>

        <textarea
          v-model="input"
          rows="1"
          :placeholder="recording ? '話しかけてください...' : 'メッセージを入力...'"
          class="w-full resize-none bg-transparent text-sm outline-none max-h-32 leading-relaxed"
          :class="recording ? 'text-white/70 placeholder-white/20' : 'text-white/90 placeholder-white/25'"
          style="field-sizing: content"
          @keydown="onKeydown"
        />
      </div>

      <!-- Mic button -->
      <button
        class="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer"
        :class="recording
          ? 'bg-rose-600/20 text-rose-400'
          : 'text-white/30 hover:text-white/70 hover:bg-white/8'"
        @click="recording ? stop() : start()"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="9" y="2" width="6" height="13" rx="3"/>
          <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <!-- Send button -->
      <button
        :disabled="!input.trim()"
        class="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
        :class="input.trim() ? 'bg-indigo-600 hover:bg-indigo-500 cursor-pointer' : 'bg-white/8 cursor-default'"
        @click="submit"
      >
        <svg class="w-4 h-4 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>
