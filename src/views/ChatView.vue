<script setup lang="ts">
import { ref } from 'vue'
import AppAside from '../components/AppAside.vue'
import TriangleNav from '../components/TriangleNav.vue'
import ChatPanel from '../components/ChatPanel.vue'
import McpPanel from '../components/McpPanel.vue'

type Panel = 'chat' | 'mcp' | null
const activePanel = ref<Panel>(null)
</script>

<template>
  <div class="flex h-screen bg-gray-950 overflow-hidden">
    <AppAside />

    <div class="relative flex-1 min-w-0">

      <Transition name="fade">
        <TriangleNav
          v-if="activePanel === null"
          class="absolute inset-0"
          @open-chat="activePanel = 'chat'"
          @open-mcp="activePanel = 'mcp'"
        />
      </Transition>

      <Transition name="panel">
        <ChatPanel
          v-if="activePanel === 'chat'"
          class="absolute inset-0"
          @close="activePanel = null"
        />
      </Transition>

      <Transition name="panel">
        <McpPanel
          v-if="activePanel === 'mcp'"
          class="absolute inset-0"
          @close="activePanel = null"
        />
      </Transition>

    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }

.panel-enter-active { transition: opacity 0.25s ease, transform 0.28s cubic-bezier(0.32, 0.72, 0, 1); }
.panel-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.panel-enter-from   { opacity: 0; transform: scale(0.97) translateY(10px); }
.panel-leave-to     { opacity: 0; transform: scale(0.98); }
</style>
