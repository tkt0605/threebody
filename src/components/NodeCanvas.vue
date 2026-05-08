<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useChat } from '../composables/useChat'
import { useTriangleNodes, FEATURES, type FeatureId } from '../composables/useTriangleNodes'
import { useTheme } from '../composables/useTheme'
import VoiceOverlay from './VoiceOverlay.vue'
import ChatDialog from './ChatDialog.vue'
import McpDialog from './McpDialog.vue'
import ContextDialog from './ContextDialog.vue'

// ── Triangle nodes (shared state) ────────────────────────────
const { placedNodes, addNode, removeNode, updatePos } = useTriangleNodes()

// ── Theme ─────────────────────────────────────────────────────
const { isDark } = useTheme()

const svgStroke    = computed(() => isDark.value ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)')
const nodeColor    = computed(() => isDark.value ? '#ffffff' : '#1e293b')
const iconColor    = computed(() => isDark.value ? '#1f2937' : '#ffffff')
const glowColor    = computed(() => isDark.value ? 'white' : '#1e293b')
const removeBg     = computed(() => isDark.value ? '#111827' : '#f1f5f9')
const removeStroke = computed(() => isDark.value ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)')
const removeText   = computed(() => isDark.value ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)')
const hintText     = computed(() => isDark.value ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)')
const labelFill    = computed(() => isDark.value ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.5)')

// ── Center position ───────────────────────────────────────────
const centerPos = reactive({ x: 300, y: 270 })

// ── Internal drag (within SVG) ────────────────────────────────
const svgRef = ref<SVGSVGElement | null>(null)
type DragId = 'center' | FeatureId
const dragging = ref<DragId | null>(null)
let dragMoved = false
let dragOrigin = { x: 0, y: 0 }

function toSvg(cx: number, cy: number) {
  const svg = svgRef.value
  if (!svg) return { x: cx, y: cy }
  const pt = svg.createSVGPoint()
  pt.x = cx; pt.y = cy
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: cx, y: cy }
  const r = pt.matrixTransform(ctm.inverse())
  return { x: r.x, y: r.y }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function onPointerDown(id: DragId, e: PointerEvent) {
  dragging.value = id
  dragMoved = false
  dragOrigin = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  e.stopPropagation()
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - dragOrigin.x
  const dy = e.clientY - dragOrigin.y
  if (dx * dx + dy * dy > 9) dragMoved = true
  const { x, y } = toSvg(e.clientX, e.clientY)
  const cx = clamp(x, 90, 510)
  const cy = clamp(y, 70, 445)
  if (dragging.value === 'center') {
    centerPos.x = cx; centerPos.y = cy
  } else {
    updatePos(dragging.value, cx, cy)
  }
}

function onPointerUp(id: DragId) {
  const wasTracked = dragging.value === id
  const moved = dragMoved
  dragging.value = null
  if (wasTracked && !moved) triggerNode(id)
}

// ── External drag-and-drop (from Aside palette) ───────────────
let dragEnterCount = 0
const isDragTarget = ref(false)

function onDragEnter() {
  dragEnterCount++
  isDragTarget.value = true
}

function onDragLeave() {
  dragEnterCount--
  if (dragEnterCount <= 0) {
    dragEnterCount = 0
    isDragTarget.value = false
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragEnterCount = 0
  isDragTarget.value = false
  const id = e.dataTransfer?.getData('featureId') as FeatureId
  if (!id) return
  const { x, y } = toSvg(e.clientX, e.clientY)
  addNode(id, clamp(x, 100, 500), clamp(y, 80, 430))
}

// ── Onboarding (Voice-first) ──────────────────────────────────
const onboarded = ref(false)
const slotsSummoned = ref(false)

function skipOnboard() {
  onboarded.value = true
  slotsSummoned.value = true
}

// ── Node actions ──────────────────────────────────────────────
const chatDialogRef = ref<InstanceType<typeof ChatDialog> | null>(null)
const mcpDialogRef  = ref<InstanceType<typeof McpDialog>  | null>(null)
const ctxDialogRef  = ref<InstanceType<typeof ContextDialog> | null>(null)

const { sendMessage } = useChat()
const { recording, finalText, interimText, bars, errorMsg, BAR_COUNT, start, stop } =
  useVoiceInput((text) => sendMessage(text))

function triggerNode(id: DragId) {
  if (id === 'center') {
    if (!onboarded.value) {
      onboarded.value = true
      setTimeout(() => { slotsSummoned.value = true }, 150)
    }
    recording.value ? stop() : start()
  }
  else if (id === 'chat')   chatDialogRef.value?.open()
  else if (id === 'mcp')    mcpDialogRef.value?.open()
  else if (id === 'ctx')    ctxDialogRef.value?.open()
}

// ── Lines (reactive) ─────────────────────────────────────────
const innerLines = computed(() =>
  placedNodes.value.map(n => ({
    x1: centerPos.x, y1: centerPos.y, x2: n.x, y2: n.y,
  }))
)

const outerLines = computed(() => {
  const n = placedNodes.value
  if (n.length < 2) return []
  const [a, b, c] = n
  if (n.length === 2) return [{ x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y }]
  return [
    { x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y },
    { x1: b!.x, y1: b!.y, x2: c!.x, y2: c!.y },
    { x1: c!.x, y1: c!.y, x2: a!.x, y2: a!.y },
  ]
})

// ── Ghost slot positions & visibility ────────────────────────
const SLOT_POS = [
  { x: 300, y: 110 },
  { x: 130, y: 400 },
  { x: 470, y: 400 },
]

const SLOT_LABEL_Y = [74, 437, 437]

const showGhostSlots = computed(() =>
  isDragTarget.value ||
  !onboarded.value ||
  (slotsSummoned.value && placedNodes.value.length < 3)
)

// ── Visuals ───────────────────────────────────────────────────
const NODE_R    = 13
const MIC_PATH  = 'M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3zM19 10v2a7 7 0 01-14 0v-2M12 18v4M9 22h6'
const STOP_PATH = 'M6 6h12v12H6z'
const ICON_S    = (NODE_R * 2 * 0.8) / 24
const ICON_H    = (24 * ICON_S) / 2

const hovered = ref<DragId | null>(null)

function shapePath(id: string, cx: number, cy: number, r: number): string {
  if (id === 'chat') {
    const x = cx - r, y = cy - r, s = r * 2, rx = r * 0.38
    return `M${x+rx},${y} H${x+s-rx} Q${x+s},${y} ${x+s},${y+rx} V${y+s-rx} Q${x+s},${y+s} ${x+s-rx},${y+s} H${x+rx} Q${x},${y+s} ${x},${y+s-rx} V${y+rx} Q${x},${y} ${x+rx},${y} Z`
  }
  if (id === 'mcp') {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    })
    return `M${pts.join(' L')} Z`
  }
  if (id === 'ctx') {
    return `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`
  }
  return ''
}
</script>

<template>
  <div
    class="relative flex items-center justify-center w-full h-full transition-shadow duration-200"
    :class="isDragTarget ? 'ring-1 ring-inset ring-black/15 dark:ring-white/15' : ''"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <svg
      ref="svgRef"
      viewBox="80 60 440 420"
      class="w-full max-w-lg h-auto select-none"
      @pointermove="onPointerMove"
      @pointerup="dragging = null"
    >
      <!-- Ghost slots -->
      <g v-if="showGhostSlots">
        <template v-for="(slot, i) in SLOT_POS" :key="`slot${i}`">
          <g
            v-if="!placedNodes.some(n => n.id === FEATURES[i]!.id)"
            :class="slotsSummoned && !isDragTarget ? `slot-summon slot-summon-${i}` : ''"
          >
            <path
              :d="shapePath(FEATURES[i]!.id, slot.x, slot.y, NODE_R + 10)"
              fill="none"
              :stroke="!onboarded || slotsSummoned ? FEATURES[i]!.color : svgStroke"
              stroke-width="1"
              stroke-dasharray="4 4"
              :opacity="!onboarded ? 0.35 : 0.22"
            />
            <text
              v-if="!onboarded || slotsSummoned"
              :x="slot.x"
              :y="SLOT_LABEL_Y[i]"
              text-anchor="middle"
              :fill="FEATURES[i]!.color"
              font-size="10"
              font-family="system-ui, -apple-system, sans-serif"
              letter-spacing="0.08em"
              opacity="0.7"
            >{{ FEATURES[i]!.label }}</text>
          </g>
        </template>
      </g>

      <!-- 三角形の辺（outer lines） -->
      <line
        v-for="(l, i) in outerLines" :key="`o${i}`"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        :stroke="svgStroke" stroke-width="0.9" opacity="0.35"
        stroke-dasharray="5 10" :class="`dash-outer-${i % 3}`"
      />

      <!-- 重心への線（inner lines） -->
      <line
        v-for="(l, i) in innerLines" :key="`n${i}`"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        :stroke="svgStroke" stroke-width="0.9" opacity="0.45"
        stroke-dasharray="4 9" :class="`dash-inner-${i % 3}`"
      />

      <!-- 内点：重心 = Voice ──────────────────── -->
      <g
        style="cursor: pointer"
        @pointerdown="(e) => onPointerDown('center', e)"
        @pointerup="() => onPointerUp('center')"
        @mouseenter="hovered = 'center'"
        @mouseleave="hovered = null"
      >
        <!-- オンボーディング中のパルスリング -->
        <g v-if="!onboarded">
          <circle :cx="centerPos.x" :cy="centerPos.y" :r="NODE_R"
            fill="none" :stroke="svgStroke" stroke-width="0.8"
            class="pulse-ring pulse-ring-0" />
          <circle :cx="centerPos.x" :cy="centerPos.y" :r="NODE_R"
            fill="none" :stroke="svgStroke" stroke-width="0.8"
            class="pulse-ring pulse-ring-1" />
          <circle :cx="centerPos.x" :cy="centerPos.y" :r="NODE_R"
            fill="none" :stroke="svgStroke" stroke-width="0.6"
            class="pulse-ring pulse-ring-2" />
        </g>

        <!-- ホバー/録音時の光彩 -->
        <circle
          :cx="centerPos.x" :cy="centerPos.y" :r="NODE_R + 16"
          :fill="glowColor"
          :opacity="recording ? 0.08 : (hovered === 'center' ? 0.06 : (!onboarded ? 0.04 : 0.02))"
          style="transition: opacity 0.2s"
        />

        <!-- 本体 -->
        <circle :cx="centerPos.x" :cy="centerPos.y" :r="NODE_R" :fill="nodeColor" />
        <g :transform="`translate(${centerPos.x - ICON_H}, ${centerPos.y - ICON_H}) scale(${ICON_S})`">
          <path
            :d="recording ? STOP_PATH : MIC_PATH"
            fill="none"
            :stroke="recording ? '#ef4444' : iconColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            style="transition: stroke 0.2s"
          />
        </g>

        <!-- オンボーディング中のヒントテキスト -->
        <text
          v-if="!onboarded"
          :x="centerPos.x" :y="centerPos.y + NODE_R + 24"
          text-anchor="middle"
          :fill="hintText"
          font-size="11"
          font-family="system-ui, -apple-system, sans-serif"
          letter-spacing="0.1em"
        >まず話しかけてください</text>
      </g>

      <!-- 外点：placed nodes ──────────────────── -->
      <g
        v-for="node in placedNodes" :key="node.id"
        style="cursor: pointer"
        @pointerdown="(e) => onPointerDown(node.id, e)"
        @pointerup="() => onPointerUp(node.id)"
        @mouseenter="hovered = node.id"
        @mouseleave="hovered = null"
      >
        <circle
          :cx="node.x" :cy="node.y" :r="NODE_R + 16"
          :fill="node.color"
          :opacity="hovered === node.id ? 0.14 : 0.04"
          style="transition: opacity 0.2s"
        />
        <path
          :d="shapePath(node.id, node.x, node.y, NODE_R + 6)"
          fill="none" :stroke="node.color" stroke-width="0.8"
          :opacity="hovered === node.id ? 0.5 : 0.2"
          style="transition: opacity 0.2s"
        />
        <path
          :d="shapePath(node.id, node.x, node.y, NODE_R)"
          :fill="node.color"
        />
        <g :transform="`translate(${node.x - ICON_H}, ${node.y - ICON_H}) scale(${ICON_S})`">
          <path
            :d="node.iconPath"
            fill="none" stroke="white" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            :opacity="hovered === node.id ? 1 : 0.8"
            style="transition: opacity 0.2s"
          />
        </g>
        <g
          v-if="hovered === node.id"
          @click.stop="removeNode(node.id)"
          @pointerdown.stop
          style="cursor: pointer"
        >
          <circle
            :cx="node.x + NODE_R + 2" :cy="node.y - NODE_R - 2"
            r="7" :fill="removeBg"
            :stroke="removeStroke" stroke-width="0.8"
          />
          <text
            :x="node.x + NODE_R + 2" :y="node.y - NODE_R - 2 + 3.5"
            text-anchor="middle"
            :fill="removeText"
            font-size="9" font-family="system-ui"
          >×</text>
        </g>
      </g>

      <!-- 機能ラベル（配置済みノード名） -->
      <text
        v-for="node in placedNodes" :key="`lbl-${node.id}`"
        :x="node.x"
        :y="node.y + NODE_R + 16"
        text-anchor="middle"
        :fill="labelFill"
        font-size="9"
        font-family="system-ui, -apple-system, sans-serif"
        letter-spacing="0.08em"
      >{{ node.label }}</text>
    </svg>

    <!-- スキップボタン（オンボーディング中のみ） -->
    <Transition name="ob">
      <div
        v-if="!onboarded"
        class="absolute bottom-6 inset-x-0 flex justify-center pointer-events-none"
      >
        <button
          class="pointer-events-auto text-xs tracking-widest transition-colors cursor-pointer
                 text-gray-300 hover:text-gray-500 dark:text-white/20 dark:hover:text-white/45"
          @click="skipOnboard"
        >スキップ</button>
      </div>
    </Transition>
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
/* ── Triangle line animations ── */
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

/* ── Pre-onboarding pulse rings ── */
@keyframes pulse-ring {
  0%   { transform: scale(1);   opacity: 0.5; }
  100% { transform: scale(4.5); opacity: 0;   }
}
.pulse-ring {
  transform-box: fill-box;
  transform-origin: center;
}
.pulse-ring-0 { animation: pulse-ring 2.4s ease-out infinite; animation-delay: 0s; }
.pulse-ring-1 { animation: pulse-ring 2.4s ease-out infinite; animation-delay: 0.8s; }
.pulse-ring-2 { animation: pulse-ring 2.4s ease-out infinite; animation-delay: 1.6s; }

/* ── Ghost slot summoning animation (Voice 召喚演出) ── */
@keyframes slot-in {
  from { opacity: 0; transform: scale(0.3); }
  to   { opacity: 1; transform: scale(1);   }
}
.slot-summon {
  transform-box: fill-box;
  transform-origin: center;
  animation: slot-in 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.slot-summon-0 { animation-delay: 0ms; }
.slot-summon-1 { animation-delay: 130ms; }
.slot-summon-2 { animation-delay: 260ms; }

/* ── Skip button transition ── */
.ob-enter-active { transition: opacity 0.3s ease; }
.ob-leave-active { transition: opacity 0.2s ease; }
.ob-enter-from, .ob-leave-to { opacity: 0; }
</style>
