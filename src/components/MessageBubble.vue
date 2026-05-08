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
        <span v-if="block.type === 'text'">
          {{ block.content }}<span v-if="message.streaming" class="animate-pulse">▍</span>
        </span>
      </template>
    </div>
  </div>
</template>
