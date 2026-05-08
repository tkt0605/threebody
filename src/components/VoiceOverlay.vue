<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  recording: boolean
  bars: number[]
  barCount: number
  finalText: string
  interimText: string
  errorMsg: string | null
  voiceActive: boolean
  responseText: string
  responseStreaming: boolean
}>()

const emit = defineEmits<{ stop: []; dismiss: [] }>()

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

const visible = computed(() => props.recording || !!props.errorMsg || props.voiceActive)
</script>

<template>
  <Teleport to="body">
    <Transition name="vo">
      <div v-if="visible" class="fixed inset-0 z-50 flex items-end justify-center pb-6 px-4">
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="recording ? emit('stop') : emit('dismiss')"
        />

        <!-- Sheet -->
        <div class="vo-sheet relative w-full max-w-md rounded-3xl shadow-2xl px-8 pt-7 pb-8 flex flex-col items-center gap-5
                    bg-white border border-black/10
                    dark:bg-gray-900 dark:border-white/10">

          <!-- ── エラー ── -->
          <p v-if="errorMsg" class="text-rose-500 dark:text-rose-400 text-sm text-center">{{ errorMsg }}</p>

          <!-- ── 録音中 ── -->
          <template v-else-if="recording">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span class="text-xs tracking-widest uppercase text-gray-500 dark:text-white/50">録音中</span>
            </div>

            <div class="min-h-[2.5rem] text-center text-sm leading-relaxed px-2">
              <span class="text-gray-900 dark:text-white/90">{{ finalText }}</span>
              <span class="text-gray-400 dark:text-white/35">{{ interimText }}</span>
              <span v-if="!finalText && !interimText" class="text-gray-300 dark:text-white/20">話しかけてください...</span>
            </div>

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

            <button
              class="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-colors cursor-pointer shadow-lg mt-1"
              @click="emit('stop')"
            >
              <span class="w-4 h-4 rounded-sm bg-white" />
            </button>
          </template>

          <!-- ── AI応答中 ── -->
          <template v-else-if="voiceActive">
            <div class="flex items-center gap-2">
              <span v-if="responseStreaming" class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <svg v-else class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="text-xs tracking-widest uppercase text-gray-500 dark:text-white/50">
                {{ responseStreaming ? 'AI応答中' : '応答完了' }}
              </span>
            </div>

            <div class="min-h-[3rem] max-h-40 overflow-y-auto text-center text-sm leading-relaxed px-2 text-gray-900 dark:text-white/85">
              <span v-if="responseText">{{ responseText }}</span>
              <span v-else class="text-gray-300 dark:text-white/20 animate-pulse">...</span>
              <span v-if="responseStreaming" class="animate-pulse text-indigo-400">▍</span>
            </div>

            <button
              class="px-6 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-sm text-white/70 transition-colors cursor-pointer"
              @click="emit('dismiss')"
            >
              閉じる
            </button>
          </template>
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
