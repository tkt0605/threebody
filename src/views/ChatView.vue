<script setup lang="ts">
import AppAside from '../components/AppAside.vue'
import NodeCanvas from '../components/NodeCanvas.vue'
</script>

<template>
  <div class="flex h-screen bg-gray-950 overflow-hidden">
    <AppAside />
    <NodeCanvas class="flex-1 min-w-0" />
  </div>
</template>
