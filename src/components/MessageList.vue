<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Message } from '../types/message'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ messages: Message[] }>()

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
      <p class="text-black/20 dark:text-white/40 text-sm select-none">最初の会話を始めましょう。</p>
    </div>
    <MessageBubble v-for="msg in messages" :key="msg.id" :message="msg" />
  </div>
</template>
