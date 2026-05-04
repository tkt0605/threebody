<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  recording: boolean
  bars: number[]
  barCount: number
  finalText: string
  interimText: string
  errorMsg: string | null
}>()

const emit = defineEmits<{ stop: [] }>()

const BAR_W  = 6
const BAR_GAP = 5
const SVG_H  = 72
const CENTER = SVG_H / 2
const MAX_HALF = 30

const svgWidth = computed(() => props.barCount * (BAR_W + BAR_GAP))

const barRects = computed(() =>
  Array.from({ length: props.barCount }, (_, i) => {
    const v = props.bars[i] ?? 0
    const h = Math.max(3, v * MAX_HALF) * 2
    return { x: i * (BAR_W + BAR_GAP), y: CENTER - h / 2, h }
  })
)
</script>

<template>
  <Teleport to="body">
    <Transition name="vo">
      <div v-if="recording || errorMsg" class="fixed inset-0 z-50 flex items-end justify-center pb-6 px-4">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="emit('stop')" />

        <!-- Sheet -->
        <div class="vo-sheet relative w-full max-w-md rounded-3xl bg-gray-900 border border-white/10 shadow-2xl px-8 pt-7 pb-8 flex flex-col items-center gap-5">

          <!-- Error -->
          <p v-if="errorMsg" class="text-rose-400 text-sm text-center">{{ errorMsg }}</p>

          <template v-else>
            <!-- Status row -->
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span class="text-xs text-white/50 tracking-widest uppercase">録音中</span>
            </div>

            <!-- Transcript -->
            <div class="min-h-[2.5rem] text-center text-sm leading-relaxed px-2">
              <span class="text-white/90">{{ finalText }}</span>
              <span class="text-white/35">{{ interimText }}</span>
              <span v-if="!finalText && !interimText" class="text-white/20">話しかけてください...</span>
            </div>

            <!-- Waveform -->
            <svg
              :viewBox="`0 0 ${svgWidth} ${SVG_H}`"
              :style="{ width: '100%', height: '56px' }"
              preserveAspectRatio="xMidYMid meet"
            >
              <rect
                v-for="(bar, i) in barRects"
                :key="i"
                :x="bar.x"
                :y="bar.y"
                :width="BAR_W"
                :height="bar.h"
                rx="3"
                :fill="`rgba(129,140,248,${0.3 + 0.7 * (bars[i] ?? 0)})`"
              />
            </svg>
          </template>

          <!-- Stop button -->
          <button
            class="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-colors cursor-pointer shadow-lg mt-1"
            @click="emit('stop')"
          >
            <span class="w-4 h-4 rounded-sm bg-white" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.vo-enter-active { transition: opacity 0.2s ease; }
.vo-leave-active { transition: opacity 0.18s ease; }
.vo-enter-from, .vo-leave-to { opacity: 0; }

.vo-sheet {
  animation: sheet-up 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes sheet-up {
  from { transform: translateY(24px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
</style>
