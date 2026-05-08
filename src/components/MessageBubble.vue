<script setup lang="ts">
import type { Message } from '../types/message'

defineProps<{ message: Message }>()
</script>

<template>
  <div
    class="flex w-full"
    :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <div
      class="max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
      :class="
        message.role === 'user'
          ? 'bg-indigo-600 text-white rounded-br-sm'
          : 'rounded-bl-sm backdrop-blur-sm bg-gray-100 text-gray-900 dark:bg-white/8 dark:text-white/90'
      "
    >
      <template v-for="block in message.blocks" :key="block.type">
        <span v-if="block.type === 'text' && (block.content || message.streaming)">
          {{ block.content }}<span v-if="message.streaming" class="animate-pulse">▍</span>
        </span>
        <div
          v-else-if="block.type === 'error'"
          class="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs bg-red-500/10 border border-red-500/30 text-red-300 mt-1"
        >
          <svg class="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ block.message }}</span>
        </div>
      </template>
    </div>
  </div>
</template>
