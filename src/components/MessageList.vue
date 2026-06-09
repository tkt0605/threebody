<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { Message } from '../types/message'
import MessageBubble from './MessageBubble.vue'
import { useSettings } from '../composables/useSettings'

const { settings } = useSettings()
const props = defineProps<{ messages: Message[] }>()

const hasActiveBody = computed(() => {
  return settings.bodies.some(b =>
    b.model.trim().length > 0 &&
    (b.provider === 'ollama' || b.apiKey.trim().length > 0)
  );
})
const container = ref<HTMLElement | null>(null)

watch(
  () => props.messages,
  () => nextTick(() => {
    if (container.value) {
      container.value.scrollTop = container.value.scrollHeight
    }
  }),
  { deep: true }
)
</script>

<template>
  <!-- <div ref="container" class="flex-1 overflow-y-auto px-4 py-6 space-y-3 scroll-smooth"> -->
  <div ref="container" class="flex-1 overflow-y-auto px-4 py-6 space-y-3 scroll-smooth [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full">
      <div v-if="messages.length === 0" class="flex h-full items-center justify-center">
        <div v-if="!hasActiveBody" class="text-black/20 dark:text-white/40 text-sm select-none">
          LLMが設定されていません。設定画面からLLMを追加してください。
        </div>
        <div v-else class="text-black/20 dark:text-white/40 text-sm select-none">
          最初の会話を始めましょう。
        </div>
      </div>
    <MessageBubble v-for="msg in messages" :key="msg.id" :message="msg" />
  </div>
</template>
