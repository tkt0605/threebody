<script setup lang="ts">
import { useChat } from '../composables/useChat'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import MessageList from '../components/MessageList.vue'
import ChatInput from '../components/ChatInput.vue'

const { messages, sendMessage } = useChat()
</script>

<template>
  <div class="flex h-screen bg-gray-950">
    <AppAside />

    <div class="flex flex-col flex-1 min-w-0">
      <AppHeader />
      <MessageList :messages="messages" />
      <ChatInput @send="sendMessage" />
    </div>
  </div>
</template>
