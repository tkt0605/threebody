<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ send: [text: string] }>()

const input = ref('')

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
