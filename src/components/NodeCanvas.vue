<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useChat } from '../composables/useChat'
import VoiceOverlay from './VoiceOverlay.vue'
import ChatDialog from './ChatDialog.vue'
import McpDialog from './McpDialog.vue'
import ContextDialog from './ContextDialog.vue'

// ── Positions ───────────────────────────────────────────────
interface Pos { x: number; y: number }
interface NodePositions { center: Pos; chat: Pos; mcp: Pos; ctx: Pos }

const pos = reactive<NodePositions>({
  center: { x: 300, y: 270 },
  chat:   { x: 300, y: 110 },
  mcp:    { x: 130, y: 400 },
  ctx:    { x: 470, y: 400 },
})

// ── Dragging ─────────────────────────────────────────────────
type NodeId = keyof NodePositions

const svgRef   = ref<SVGSVGElement | null>(null)
const dragging = ref<NodeId | null>(null)
let dragMoved  = false
let dragOrigin = { x: 0, y: 0 }

function toSvg(cx: number, cy: number): Pos {
  const svg = svgRef.value
  if (!svg) return { x: cx, y: cy }
  const pt  = svg.createSVGPoint()
  pt.x = cx; pt.y = cy
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: cx, y: cy }
  const r = pt.matrixTransform(ctm.inverse())
  return { x: r.x, y: r.y }
}

function onPointerDown(id: NodeId, e: PointerEvent) {
  dragging.value = id
  dragMoved      = false
  dragOrigin     = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  e.stopPropagation()
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - dragOrigin.x
  const dy = e.clientY - dragOrigin.y
  if (dx * dx + dy * dy > 9) dragMoved = true
  const { x, y } = toSvg(e.clientX, e.clientY)
  pos[dragging.value].x = Math.max(90, Math.min(510, x))
  pos[dragging.value].y = Math.max(70, Math.min(445, y))
}

function onPointerUp(id: NodeId) {
  const moved = dragMoved
  dragging.value = null
  if (!moved) triggerNode(id)
}

// ── Actions ──────────────────────────────────────────────────
const chatDialogRef = ref<InstanceType<typeof ChatDialog>     | null>(null)
const mcpDialogRef  = ref<InstanceType<typeof McpDialog>      | null>(null)
const ctxDialogRef  = ref<InstanceType<typeof ContextDialog>  | null>(null)

const { sendMessage } = useChat()
const { recording, finalText, interimText, bars, errorMsg, BAR_COUNT, start, stop } =
  useVoiceInput((text) => sendMessage(text))

function triggerNode(id: NodeId) {
  if      (id === 'center') recording.value ? stop() : start()
  else if (id === 'chat')   chatDialogRef.value?.open()
  else if (id === 'mcp')    mcpDialogRef.value?.open()
  else if (id === 'ctx')    ctxDialogRef.value?.open()
}

// ── Lines (reactive) ─────────────────────────────────────────
const outerLines = computed(() => [
  { x1: pos.chat.x, y1: pos.chat.y, x2: pos.mcp.x,    y2: pos.mcp.y    },
  { x1: pos.mcp.x,  y1: pos.mcp.y,  x2: pos.ctx.x,    y2: pos.ctx.y    },
  { x1: pos.ctx.x,  y1: pos.ctx.y,  x2: pos.chat.x,   y2: pos.chat.y   },
])
const innerLines = computed(() => [
  { x1: pos.center.x, y1: pos.center.y, x2: pos.chat.x, y2: pos.chat.y },
  { x1: pos.center.x, y1: pos.center.y, x2: pos.mcp.x,  y2: pos.mcp.y  },
  { x1: pos.center.x, y1: pos.center.y, x2: pos.ctx.x,  y2: pos.ctx.y  },
])

// ── Outer nodes definition ────────────────────────────────────
// iconPath: Feather/Heroicons 24x24 paths
// iconDy: SVG座標でのノード中心からアイコン左上までのY offset
const NODE_R = 13  // 全ノード共通半径

const OUTER = [
  {
    id: 'chat' as NodeId, color: '#f87171',
    iconPath: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  },
  {
    id: 'mcp' as NodeId, color: '#4ade80',
    iconPath: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  },
  {
    id: 'ctx' as NodeId, color: '#60a5fa',
    iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8',
  },
]

const MIC_PATH  = 'M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3zM19 10v2a7 7 0 01-14 0v-2M12 18v4M9 22h6'
const STOP_PATH = 'M6 6h12v12H6z'
// ノード直径の約80%をアイコンが占める
const ICON_S = (NODE_R * 2 * 0.8) / 24
const ICON_H = (24 * ICON_S) / 2

const hovered = ref<NodeId | null>(null)
</script>

<template>
  <div class="flex items-center justify-center w-full h-full">
    <svg
      ref="svgRef"
      viewBox="80 60 440 420"
      class="w-full max-w-lg h-auto select-none"
      @pointermove="onPointerMove"
      @pointerup="dragging = null"
    >
      <!-- 三角形の辺（点線・流れる） -->
      <line
        v-for="(l, i) in outerLines" :key="`o${i}`"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        stroke="white" stroke-width="0.9" opacity="0.35"
        stroke-dasharray="5 10" :class="`dash-outer-${i}`"
      />
      <!-- 重心への線（点線・速く流れる） -->
      <line
        v-for="(l, i) in innerLines" :key="`n${i}`"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        stroke="white" stroke-width="0.9" opacity="0.45"
        stroke-dasharray="4 9" :class="`dash-inner-${i}`"
      />

      <!-- 内点：重心 = Voice ──────────────────── -->
      <g
        :style="{ cursor: recording ? 'pointer' : 'pointer' }"
        @pointerdown="(e) => onPointerDown('center', e)"
        @pointerup="() => onPointerUp('center')"
        @mouseenter="hovered = 'center'"
        @mouseleave="hovered = null"
      >
        <!-- 録音中パルス -->
        <circle
          :cx="pos.center.x" :cy="pos.center.y" :r="NODE_R + 16"
          fill="white"
          :opacity="recording ? 0.08 : (hovered === 'center' ? 0.06 : 0.02)"
          style="transition: opacity 0.2s"
        />
        <circle :cx="pos.center.x" :cy="pos.center.y" :r="NODE_R" fill="white" opacity="1" />
        <g :transform="`translate(${pos.center.x - ICON_H}, ${pos.center.y - ICON_H}) scale(${ICON_S})`">
          <path
            :d="recording ? STOP_PATH : MIC_PATH"
            fill="none"
            :stroke="recording ? '#ef4444' : '#1f2937'"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            style="transition: stroke 0.2s"
          />
        </g>
      </g>

      <!-- 外点：Chat / MCP / Context ─────────── -->
      <g
        v-for="node in OUTER" :key="node.id"
        style="cursor: pointer"
        @pointerdown="(e) => onPointerDown(node.id, e)"
        @pointerup="() => onPointerUp(node.id)"
        @mouseenter="hovered = node.id"
        @mouseleave="hovered = null"
      >
        <circle
          :cx="pos[node.id].x" :cy="pos[node.id].y"
          :r="NODE_R + 16"
          :fill="node.color"
          :opacity="hovered === node.id ? 0.14 : 0.04"
          style="transition: opacity 0.2s"
        />
        <circle
          :cx="pos[node.id].x" :cy="pos[node.id].y"
          :r="NODE_R + 6"
          fill="none" :stroke="node.color" stroke-width="0.8"
          :opacity="hovered === node.id ? 0.5 : 0.2"
          style="transition: opacity 0.2s"
        />
        <circle
          :cx="pos[node.id].x" :cy="pos[node.id].y"
          :r="NODE_R" :fill="node.color"
        />
        <!-- 点の内側にアイコン -->
        <g :transform="`translate(${pos[node.id].x - ICON_H}, ${pos[node.id].y - ICON_H}) scale(${ICON_S})`">
          <path
            :d="node.iconPath"
            fill="none" stroke="white" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            :opacity="hovered === node.id ? 1 : 0.8"
            style="transition: opacity 0.2s"
          />
        </g>
      </g>
    </svg>
  </div>

  <!-- Voice overlay -->
  <VoiceOverlay
    :recording="recording" :bars="bars" :bar-count="BAR_COUNT"
    :final-text="finalText" :interim-text="interimText" :error-msg="errorMsg"
    @stop="stop"
  />

  <!-- Dialogs -->
  <ChatDialog    ref="chatDialogRef" />
  <McpDialog     ref="mcpDialogRef"  />
  <ContextDialog ref="ctxDialogRef"  />
</template>

<style scoped>
@keyframes flow {
  from { stroke-dashoffset: 15; }
  to   { stroke-dashoffset: 0;  }
}
.dash-outer-0 { animation: flow 2.4s linear infinite; }
.dash-outer-1 { animation: flow 3.0s linear infinite; }
.dash-outer-2 { animation: flow 2.7s linear infinite; }
.dash-inner-0 { animation: flow 1.8s linear infinite; }
.dash-inner-1 { animation: flow 2.1s linear infinite; }
.dash-inner-2 { animation: flow 1.5s linear infinite; }
</style>
