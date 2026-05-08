<script setup lang="ts">
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import NodeCanvas from '../components/NodeCanvas.vue'
</script>

<template>
  <div class="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <AppAside />
    <div class="flex flex-col flex-1 min-w-0">
      <AppHeader />
      <NodeCanvas class="flex-1" />
    </div>
  </div>
</template>
