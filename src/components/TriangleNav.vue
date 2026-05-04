<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  openChat: []
  openMcp: []
}>()

const hovered = ref<string | null>(null)

const CX = 300
const CY = 297

const NODES = [
  {
    id: 'chat',
    x: 300, y: 110,
    color: '#f87171',
    r: 7,
    label: 'Chat',
    labelDy: -22,
    active: true,
    action: () => emit('openChat'),
  },
  {
    id: 'mcp',
    x: 130, y: 390,
    color: '#4ade80',
    r: 6,
    label: 'MCP · Files',
    labelDy: 26,
    active: true,
    action: () => emit('openMcp'),
  },
  {
    id: 'other',
    x: 470, y: 390,
    color: '#60a5fa',
    r: 5,
    label: '—',
    labelDy: 26,
    active: false,
    action: () => {},
  },
] as const

// 三角形の辺（外側）: ゆっくり流れる
const OUTER_LINES = [
  { x1: 300, y1: 110, x2: 130, y2: 390 },
  { x1: 130, y1: 390, x2: 470, y2: 390 },
  { x1: 470, y1: 390, x2: 300, y2: 110 },
]

// 重心への線（内側）: 少し速く流れる
const INNER_LINES = [
  { x1: CX, y1: CY, x2: 300, y2: 110 },
  { x1: CX, y1: CY, x2: 130, y2: 390 },
  { x1: CX, y1: CY, x2: 470, y2: 390 },
]
</script>

<template>
  <div class="flex items-center justify-center w-full h-full">
    <svg viewBox="80 60 440 390" class="w-full max-w-lg h-auto select-none">
      <!-- 三角形の辺（点線・流れる） -->
      <line
        v-for="(l, i) in OUTER_LINES"
        :key="`o${i}`"
        :x1="l.x1" :y1="l.y1"
        :x2="l.x2" :y2="l.y2"
        stroke="white" stroke-width="0.9" opacity="0.35"
        stroke-dasharray="5 10"
        :class="`dash-outer-${i}`"
      />

      <!-- 重心への線（点線・速く流れる） -->
      <line
        v-for="(l, i) in INNER_LINES"
        :key="`n${i}`"
        :x1="l.x1" :y1="l.y1"
        :x2="l.x2" :y2="l.y2"
        stroke="white" stroke-width="0.9" opacity="0.45"
        stroke-dasharray="4 9"
        :class="`dash-inner-${i}`"
      />

      <!-- 内点（重心） -->
      <circle :cx="CX" :cy="CY" r="14" fill="white" opacity="0.12" />
      <circle :cx="CX" :cy="CY" r="4" fill="white" opacity="1" />

      <!-- 外点 -->
      <g
        v-for="node in NODES"
        :key="node.id"
        :style="{ cursor: node.active ? 'pointer' : 'default' }"
        @mouseenter="hovered = node.id"
        @mouseleave="hovered = null"
        @click="node.action()"
      >
        <!-- ホバーグロー -->
        <circle
          :cx="node.x" :cy="node.y"
          :r="node.r + 14"
          :fill="node.color"
          :opacity="hovered === node.id && node.active ? 0.14 : 0.04"
          style="transition: opacity 0.2s"
        />
        <!-- アウターリング -->
        <circle
          :cx="node.x" :cy="node.y"
          :r="node.r + 5"
          fill="none"
          :stroke="node.color"
          stroke-width="0.8"
          :opacity="node.active ? (hovered === node.id ? 0.5 : 0.2) : 0.08"
          style="transition: opacity 0.2s"
        />
        <!-- コアドット -->
        <circle
          :cx="node.x" :cy="node.y"
          :r="node.r"
          :fill="node.color"
          :opacity="node.active ? 1 : 0.2"
        />
        <!-- ラベル -->
        <text
          :x="node.x" :y="node.y + node.labelDy"
          text-anchor="middle"
          :fill="node.active ? (hovered === node.id ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)') : 'rgba(255,255,255,0.15)'"
          font-size="11"
          font-family="system-ui, -apple-system, sans-serif"
          letter-spacing="0.07em"
          style="transition: fill 0.2s"
        >{{ node.label }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
@keyframes flow {
  from { stroke-dashoffset: 15; }
  to   { stroke-dashoffset: 0;  }
}

/* 三角形の辺 — 各辺で微妙に速度を変えてカオス感を出す */
.dash-outer-0 { animation: flow 2.4s linear infinite; }
.dash-outer-1 { animation: flow 3.0s linear infinite; }
.dash-outer-2 { animation: flow 2.7s linear infinite; }

/* 重心への線 — 少し速め */
.dash-inner-0 { animation: flow 1.8s linear infinite; }
.dash-inner-1 { animation: flow 2.1s linear infinite; }
.dash-inner-2 { animation: flow 1.5s linear infinite; }
</style>
