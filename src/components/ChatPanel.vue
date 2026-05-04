<script setup lang="ts">
import { useChat } from '../composables/useChat'
import MessageList from './MessageList.vue'
import ChatInput from './ChatInput.vue'

defineEmits<{ close: [] }>()

const { messages, sendMessage } = useChat()
</script>

<template>
  <div class="flex flex-col w-full h-full bg-gray-950">
    <header class="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
      <span class="text-sm text-white/50">Chat</span>
      <button
        class="text-white/30 hover:text-white/70 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </header>
    <MessageList :messages="messages" />
    <ChatInput @send="sendMessage" />
  </div>
</template>
