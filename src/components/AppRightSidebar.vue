<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import McpDialog from './McpDialog.vue'
import ContextDialog from './ContextDialog.vue'

const props = defineProps<{
  recording:     boolean
  bars:          number[]
  input:         string
  wakeListening: boolean
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  'toggle-mic': []
  'open-mcp': []
  'open-context': []
}>()

const mcpRef = ref<InstanceType<typeof McpDialog> | null>(null)
const ctxRef = ref<InstanceType<typeof ContextDialog> | null>(null)

// ── iris 準拠の Canvas 粒子球体 ──────────────────────────────
const CORE_PARTICLE_COUNT = 1000
const CORE_RADIUS = 40
const COLOR_CYAN   = { r: 34,  g: 211, b: 238 }  // 待機・ウェイクワード検知中
const COLOR_PURPLE = { r: 167, g: 139, b: 250 }  // ウェイクワード待機中（区別用）
const COLOR_RED    = { r: 248, g: 113, b: 113 }  // 録音

interface CoreParticle { basePos: { x: number; y: number; z: number } }

// フィボナッチ球面分布（iris と同一アルゴリズム）
const coreParticles: CoreParticle[] = (() => {
  const phi = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: CORE_PARTICLE_COUNT }, (_, i) => {
    const y = 1 - (i / (CORE_PARTICLE_COUNT - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = phi * i
    return { basePos: { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r } }
  })
})()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let animationId: number | null = null
let frameTime = 0  // 回転角の累積カウンタ

function startLoop() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const render = () => {
    frameTime++
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const isRec = props.recording

    // bars (0-1) を iris の currentLevel スケールに変換
    const avg = props.bars.length
      ? props.bars.reduce((a, b) => a + b, 0) / props.bars.length
      : 0
    const currentLevel = avg * 8.5  // iris: average / 30 (0-255byte) と等価

    const color = isRec ? COLOR_RED : props.wakeListening ? COLOR_PURPLE : COLOR_CYAN
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`

    // 待機中のみゆっくり回転、録音中は停止（iris と同一）
    const rot = frameTime * (isRec ? 0 : 0.002)

    // 簡易透視投影（iris と同一）
    const project = (x: number, y: number, z: number) => {
      const s = 300 / (300 + z)
      return { x: cx + x * s, y: cy + y * s, s }
    }

    for (const p of coreParticles) {
      // 録音中：音量に応じてランダム振動
      const vx = isRec ? (Math.random() - 0.5) * currentLevel * 12 : 0
      const vy = isRec ? (Math.random() - 0.5) * currentLevel * 12 : 0
      const vz = isRec ? (Math.random() - 0.5) * currentLevel * 12 : 0

      // 音量で膨張（iris と同一）
      const exp = isRec ? 1.0 + currentLevel * 0.1 : 1.0

      const px = p.basePos.x * CORE_RADIUS * exp + vx
      const py = p.basePos.y * CORE_RADIUS * exp + vy
      const pz = p.basePos.z * CORE_RADIUS * exp + vz

      // Y 軸回転（iris と同一）
      const rx = px * Math.cos(rot) - pz * Math.sin(rot)
      const rz = px * Math.sin(rot) + pz * Math.cos(rot)

      const { x, y, s } = project(rx, py, rz)

      ctx.globalAlpha = Math.max(0.1, s * 0.8)
      ctx.beginPath()
      ctx.arc(x, y, (isRec ? 1.5 : 1.0) * s, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    animationId = requestAnimationFrame(render)
  }

  animationId = requestAnimationFrame(render)
}

function stopLoop() {
  if (animationId) { cancelAnimationFrame(animationId); animationId = null }
}

function resizeCanvas() {
  const canvas = canvasRef.value
  if (!canvas?.parentElement) return
  canvas.width  = canvas.parentElement.clientWidth
  canvas.height = canvas.parentElement.clientHeight
}

onMounted(() => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  startLoop()
})

onUnmounted(() => {
  stopLoop()
  window.removeEventListener('resize', resizeCanvas)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <aside class="flex flex-col w-76 h-screen border-l border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <!-- ヘッダー -->
    <div class="flex items-center gap-2 px-5 py-5.5 border-b border-black/8 dark:border-white/8">
      <svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="text-sm font-semibold text-gray-900 dark:text-white/90">プロンプト入力</span>
    </div>

    <!-- Canvas 音声認識エリア -->
    <div class="border-b border-black/8 dark:border-white/8">
      <div class="relative w-full rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-950" style="aspect-ratio: 1">
        <canvas
          ref="canvasRef"
          class="block w-full h-full cursor-pointer"
          @click="emit('toggle-mic')"
        />

        <!-- ステータスオーバーレイ（iris の showUI 相当） -->
        <div class="absolute inset-0 flex flex-col items-center justify-end pb-4 pointer-events-none gap-1">
          <Transition name="status" mode="out-in">
            <span
              v-if="recording"
              key="rec"
              class="text-[11px] tracking-[0.2em] font-semibold text-red-400"
            >● 聴いてます</span>
            <span
              v-else-if="wakeListening"
              key="wake"
              class="text-[11px] tracking-[0.15em] font-semibold text-violet-400"
            >「アイリス」と呼んで</span>
          </Transition>
          <!-- クリック起動ヒント（待機中のみ） -->
          <span
            v-if="!recording"
            class="text-[10px] text-gray-400 dark:text-white/25 tracking-wide"
          >またはタップで起動</span>
        </div>
      </div>
    </div>

    <!-- テキスト入力エリア -->
    <div class="flex flex-col flex-1 justify-end px-3 py-4 gap-3">
      <div
        class="flex flex-col gap-2 rounded-2xl border px-4 py-3 transition-colors
               bg-white border-black/10 focus-within:border-indigo-400/60
               dark:bg-white/5 dark:border-white/10 dark:focus-within:border-indigo-400/40"
      >
        <textarea
          :value="input"
          rows="3"
          placeholder="メッセージを入力..."
          class="w-full resize-none bg-transparent text-sm outline-none leading-relaxed
                 text-gray-900 placeholder-black/30
                 dark:text-white/90 dark:placeholder-white/25"
          @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)"
          @keydown="onKeydown"
        />
        <div class="flex justify-end pt-1 border-t border-black/6 dark:border-white/6">
          <button
            :disabled="!input.trim()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
            :class="input.trim()
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
              : 'bg-black/6 dark:bg-white/6 text-gray-400 dark:text-white/25 cursor-default'"
            @click="emit('submit')"
          >
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            送信
          </button>
        </div>
      </div>
      <p class="text-[11px] text-gray-400 dark:text-white/25 px-1">
        <kbd class="font-mono">Enter</kbd> で送信　<kbd class="font-mono">Shift+Enter</kbd> で改行
      </p>
    </div>
  </aside>

  <McpDialog ref="mcpRef" />
  <ContextDialog ref="ctxRef" />
</template>

<style scoped>
.status-enter-active, .status-leave-active { transition: opacity 0.3s, transform 0.3s; }
.status-enter-from { opacity: 0; transform: translateY(4px); }
.status-leave-to   { opacity: 0; transform: translateY(-4px); }
</style>
