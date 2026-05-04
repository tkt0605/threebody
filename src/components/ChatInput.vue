<script setup lang="ts">
import { ref } from 'vue'
import { useVoiceInput } from '../composables/useVoiceInput'
import VoiceOverlay from './VoiceOverlay.vue'

const emit = defineEmits<{ send: [text: string] }>()

const input = ref('')

const { recording, finalText, interimText, bars, errorMsg, BAR_COUNT, start, stop } =
  useVoiceInput((text) => { input.value = text })

function submit() {
  const text = input.value.trim()
  if (!text) return
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
    <div class="flex items-end gap-2 rounded-2xl bg-white/8 backdrop-blur-sm border border-white/10 px-4 py-3 focus-within:border-white/25 transition-colors">
      <textarea
        v-model="input"
        rows="1"
        placeholder="メッセージを入力..."
        class="flex-1 resize-none bg-transparent text-white/90 placeholder-white/25 text-sm outline-none max-h-32 leading-relaxed"
        style="field-sizing: content"
        @keydown="onKeydown"
      />

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

  <VoiceOverlay
    :recording="recording"
    :bars="bars"
    :bar-count="BAR_COUNT"
    :final-text="finalText"
    :interim-text="interimText"
    :error-msg="errorMsg"
    @stop="stop"
  />
</template>
