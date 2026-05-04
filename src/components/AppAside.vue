<script setup lang="ts">
import ThreeBodyLogo from './ThreeBodyLogo.vue'
</script>

<template>
  <aside class="flex flex-col w-60 h-screen border-r border-white/8 shrink-0">
    <div class="flex items-center gap-2.5 px-5 py-2 border-b border-white/8">
      <ThreeBodyLogo />
      <span class="text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>
    </div>

    <div class="px-3 py-3">
      <button class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-white/60 hover:text-white/90 hover:bg-white/6 text-sm transition-colors cursor-pointer">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        新しい会話
      </button>
    </div>

    <nav class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
      <!-- 会話履歴（今後実装） -->
    </nav>
  </aside>
</template>
