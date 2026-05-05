<script setup lang="ts">
import { ref } from 'vue'
import ThreeBodyLogo from './ThreeBodyLogo.vue'
import SettingsDialog from './SettingsDialog.vue'
import { FEATURES, useTriangleNodes } from '../composables/useTriangleNodes'

const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null)

const building = ref(false)
const built = ref(false)

const { isPlaced } = useTriangleNodes()

function build() {
  building.value = true
  built.value = false
  setTimeout(() => {
    building.value = false
    built.value = true
    setTimeout(() => { built.value = false }, 2000)
  }, 1200)
}

function onDragStart(e: DragEvent, id: string) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('featureId', id)
  e.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="flex flex-col w-60 h-screen border-r border-white/8 shrink-0">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-5 py-2">
      <ThreeBodyLogo />
      <span class="text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>
    </div>

    <!-- Actions -->
    <div class="px-3 py-3 border-b border-white/8 space-y-1.5">
      <!-- 設定変更 -->
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/55 hover:text-white/90 hover:bg-white/6 text-sm transition-colors cursor-pointer"
        @click="settingsDialog?.open()"
      >
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        設定変更
      </button>

      <!-- ビルド -->
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer"
        :class="built
          ? 'bg-emerald-600/20 text-emerald-400'
          : 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 hover:text-indigo-300'"
        :disabled="building"
        @click="build"
      >
        <svg v-if="building" class="w-4 h-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
        </svg>
        <svg v-else-if="built" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {{ building ? 'ビルド中...' : built ? '完了' : 'ビルド' }}
      </button>
    </div>

    <!-- Feature palette: drag to add to triangle -->
    <div class="px-3 py-3 border-b border-white/8">
      <p class="text-[10px] text-white/25 uppercase tracking-widest mb-1.5 px-1">三体に追加</p>

      <!-- Voice: always at center, not draggable -->
      <div class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm select-none opacity-35 cursor-default">
        <span class="w-2 h-2 rounded-full bg-white shrink-0" />
        <span class="text-white/60">Voice</span>
        <span class="ml-auto text-[10px] text-white/40">重心</span>
      </div>

      <!-- Draggable features -->
      <div
        v-for="feat in FEATURES"
        :key="feat.id"
        :draggable="!isPlaced(feat.id)"
        @dragstart="onDragStart($event, feat.id)"
        class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm select-none transition-all"
        :class="isPlaced(feat.id)
          ? 'opacity-35 cursor-default'
          : 'cursor-grab text-white/65 hover:text-white/90 hover:bg-white/6 active:cursor-grabbing'"
      >
        <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: feat.color }" />
        <span>{{ feat.name }}</span>
        <!-- drag handle (unplaced) -->
        <svg v-if="!isPlaced(feat.id)" class="ml-auto w-3 h-3 text-white/25" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
        <!-- checkmark (placed) -->
        <svg v-else class="ml-auto w-3 h-3 text-white/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- 会話リスト (placeholder) -->
    <nav class="flex-1 overflow-y-auto px-3 py-2" />
  </aside>

  <SettingsDialog ref="settingsDialog" />
</template>
