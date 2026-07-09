<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Message } from '../types/message'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ messages: Message[]; draftMessage?: Message | null }>()

const container = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    if (container.value) {
      container.value.scrollTop = container.value.scrollHeight
    }
  })
}

watch(() => props.messages, scrollToBottom, { deep: true })
watch(() => props.draftMessage, scrollToBottom, { deep: true })

// リロード等でAIの返答が保存される前に途切れ、応答が欠けたまま宙ぶらりんになったユーザー発言かどうか
function isOrphaned(msg: Message, index: number): boolean {
  if (msg.role !== 'user') return false
  const next = props.messages[index + 1]
  return !next || next.role !== 'assistant'
}
</script>

<template>
  <!-- <div ref="container" class="flex-1 overflow-y-auto px-4 py-6 space-y-3 scroll-smooth"> -->
  <div ref="container" class="flex-1 overflow-y-auto py-6 scroll-smooth [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full">
      <div v-if="messages.length === 0 && !draftMessage" class="flex h-full items-center justify-center">
        <div class="text-black/20 dark:text-white/40 text-sm select-none">
          最初の会話を始めましょう。
        </div>
      </div>
    <div class="max-w-3xl mx-auto px-4 space-y-3">
      <MessageBubble
        v-for="(msg, idx) in messages"
        :key="msg.id"
        :message="msg"
        :orphaned="isOrphaned(msg, idx)"
      />
      <MessageBubble v-if="draftMessage" :message="draftMessage" />
    </div>
  </div>
</template>
