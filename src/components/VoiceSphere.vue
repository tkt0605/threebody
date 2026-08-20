<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useChat } from '../composables/useChat'
import { useSettings, type BodyConfig, type BodyProvider } from '../composables/useSettings'
import { BODY_PROVIDER_COLORS } from '../constants/bodyProviders'

const props = withDefaults(defineProps<{
  recording:     boolean
  bars:          number[]
  wakeListening: boolean
  showStatus?:   boolean
  idleLabel?:    string
}>(), {
  showStatus: true,
  idleLabel:  'タップして起動',
})

const emit = defineEmits<{ click: [] }>()

const { aiState, pendingBodies } = useChat()
const { settings } = useSettings()

// ── iris 準拠の Canvas 粒子球体 ──────────────────────────────
const CORE_PARTICLE_COUNT = 1000
const CORE_RADIUS = 40
const MAX_CLUSTERS = 3
const SUB_DIVISIONS = 6  // 2分割・3分割どちらにも均等に対応できる公倍数
const COLOR_CYAN   = { r: 34,  g: 211, b: 238 }  // 待機・ウェイクワード検知中
const COLOR_PURPLE = { r: 167, g: 139, b: 250 }  // ウェイクワード待機中（区別用）
const COLOR_RED    = { r: 248, g: 113, b: 113 }  // 録音

interface CoreParticle { basePos: { x: number; y: number; z: number }; subIndex: number }

// フィボナッチ球面分布（iris と同一アルゴリズム）。subIndex でクラスタに均等振り分け
const coreParticles: CoreParticle[] = (() => {
  const phi = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: CORE_PARTICLE_COUNT }, (_, i) => {
    const y = 1 - (i / (CORE_PARTICLE_COUNT - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = phi * i
    return { basePos: { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }, subIndex: i % SUB_DIVISIONS }
  })
})()

// ── クラスタ配置（reviewing 時に検算中の体の数だけ分裂、それ以外は中心に収束） ──
const TRIANGLE_RADIUS = CORE_RADIUS * 1.4
function clusterTargets(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: Math.cos(angle) * TRIANGLE_RADIUS, y: Math.sin(angle) * TRIANGLE_RADIUS, z: 0 }
  })
}
const CLUSTER_TARGETS: Record<2 | 3, { x: number; y: number; z: number }[]> = {
  2: clusterTargets(2),
  3: clusterTargets(3),
}
const MERGED_TARGET = { x: 0, y: 0, z: 0 }
const CLUSTER_EASE = 0.08
const clusterCenters = Array.from({ length: MAX_CLUSTERS }, () => ({ x: 0, y: 0, z: 0 }))

// 設定済み（model指定済み・ollama以外はAPIキーも設定済み）の体の数
function isBodyAvailable(b: BodyConfig) {
  return b.model.trim().length > 0 && (b.provider === 'ollama' || b.apiKey.trim().length > 0)
}

// 各体のプロバイダーカラー（reviewing 時のクラスタ色分け用）
function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
const BODY_PROVIDER_RGB = Object.fromEntries(
  Object.entries(BODY_PROVIDER_COLORS).map(([provider, hex]) => [provider, hexToRgb(hex)])
) as Record<BodyProvider, { r: number; g: number; b: number }>

// クラスタごとの脈動リズム（周波数・位相をずらして「思考」のばらつきを表現）
const CLUSTER_PULSE_FREQ  = [0.05, 0.07, 0.09]
const CLUSTER_PULSE_PHASE = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
const CLUSTER_PULSE_AMOUNT = 0.15

// converging（本文ストリーム中）：1つの球として脈動
const CONVERGING_PULSE_FREQ = 0.1
const CONVERGING_PULSE_AMOUNT = 0.05

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

    // 応答生成中（thinking〜converging〜reviewing）は完了するまで待機色（青）に戻さず、
    // 主体（一体）のプロバイダー色を保持する（統合中に色が一瞬青に戻ってしまう不自然さを防ぐ）
    const primaryBody = aiState.value !== 'idle' ? settings.bodies.find(isBodyAvailable) : undefined
    const processingColor = primaryBody ? BODY_PROVIDER_RGB[primaryBody.provider] : null
    const color = isRec ? COLOR_RED : props.wakeListening ? COLOR_PURPLE : processingColor ?? COLOR_CYAN
    const defaultFillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`

    // 待機中のみゆっくり回転、録音中は停止（iris と同一）
    const rot = frameTime * (isRec ? 0 : 0.002)

    // 簡易透視投影（iris と同一）
    const project = (x: number, y: number, z: number) => {
      const s = 300 / (300 + z)
      return { x: cx + x * s, y: cy + y * s, s }
    }

    // reviewing 中は「まだ検算中の副体」の数に応じて分裂し、1体ずつ完了するたびにクラスタが
    // 中心へ収束していく（= 待ち時間の進捗が見える化される）。thinking/converging は常に1つ。
    // 統合方式では副体が本文より先に走ったので、ここは thinking を見ていた
    const isThreeBody = aiState.value === 'reviewing' && pendingBodies.value.length > 0
    const availableBodies = isThreeBody
      ? pendingBodies.value
      : settings.bodies.filter(isBodyAvailable)
    const activeBodyCount = availableBodies.length
    const clusterCount = activeBodyCount >= 3 ? 3 : activeBodyCount === 2 ? 2 : 1
    const splitting = aiState.value === 'reviewing' && !isRec && clusterCount >= 2
    const targets = clusterCount === 3 ? CLUSTER_TARGETS[3] : CLUSTER_TARGETS[2]
    for (let g = 0; g < MAX_CLUSTERS; g++) {
      const target = splitting && g < clusterCount ? targets[g]! : MERGED_TARGET
      const c = clusterCenters[g]!
      c.x += (target.x - c.x) * CLUSTER_EASE
      c.y += (target.y - c.y) * CLUSTER_EASE
      c.z += (target.z - c.z) * CLUSTER_EASE
    }
    const subDivisor = splitting ? clusterCount : MAX_CLUSTERS

    // クラスタごとの色（担当する体のプロバイダーカラー）
    const clusterFillStyles = splitting
      ? Array.from({ length: clusterCount }, (_, g) => {
          const rgb = BODY_PROVIDER_RGB[availableBodies[g]?.provider ?? 'ollama']
          return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
        })
      : null

    for (const p of coreParticles) {
      const clusterIdx = p.subIndex % subDivisor

      // reviewing 中：クラスタごとに異なるリズムで脈動 / converging 中：1つの球として脈動
      const pulse = splitting
        ? 1 + Math.sin(frameTime * CLUSTER_PULSE_FREQ[clusterIdx]! + CLUSTER_PULSE_PHASE[clusterIdx]!) * CLUSTER_PULSE_AMOUNT
        : (aiState.value === 'converging' || aiState.value === 'thinking') && !isRec
          ? 1 + Math.sin(frameTime * CONVERGING_PULSE_FREQ) * CONVERGING_PULSE_AMOUNT
          : 1

      // 録音中：音量に応じてランダム振動
      const vx = isRec ? (Math.random() - 0.5) * currentLevel * 12 : 0
      const vy = isRec ? (Math.random() - 0.5) * currentLevel * 12 : 0
      const vz = isRec ? (Math.random() - 0.5) * currentLevel * 12 : 0

      // 音量で膨張（iris と同一）+ thinking 時のクラスタ脈動
      const exp = (isRec ? 1.0 + currentLevel * 0.1 : 1.0) * pulse

      const px = p.basePos.x * CORE_RADIUS * exp + vx
      const py = p.basePos.y * CORE_RADIUS * exp + vy
      const pz = p.basePos.z * CORE_RADIUS * exp + vz

      // Y 軸回転（iris と同一）
      const rx = px * Math.cos(rot) - pz * Math.sin(rot)
      const rz = px * Math.sin(rot) + pz * Math.cos(rot)

      // クラスタ中心オフセットを加算（reviewing 時の分裂）
      const c = clusterCenters[clusterIdx]!
      const { x, y, s } = project(rx + c.x, py + c.y, rz + c.z)

      ctx.globalAlpha = Math.max(0.1, s * 0.8)
      ctx.fillStyle = clusterFillStyles ? clusterFillStyles[clusterIdx]! : defaultFillStyle
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

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  resizeCanvas()
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (canvasRef.value?.parentElement) resizeObserver.observe(canvasRef.value.parentElement)
  window.addEventListener('resize', resizeCanvas)
  startLoop()
})

onUnmounted(() => {
  stopLoop()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<template>
  <div class="relative w-full h-full rounded-full overflow-hidden bg-gray-50 dark:bg-gray-950" style="aspect-ratio: 1">
    <canvas
      ref="canvasRef"
      class="block w-full h-full cursor-pointer"
      @click="emit('click')"
    />

    <!-- ステータスオーバーレイ（iris の showUI 相当） -->
    <div v-if="showStatus" class="absolute inset-0 flex flex-col items-center justify-end pb-4 pointer-events-none gap-1">
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
        <span
          v-else-if="aiState !== 'idle'"
          key="thinking"
          class="text-[11px] tracking-[0.15em] font-semibold text-emerald-400"
        >考えています…</span>
        <span
          v-else
          key="init"
          class="text-[11px] tracking-[0.15em] text-cyan-500/70"
        >{{ idleLabel }}</span>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.status-enter-active, .status-leave-active { transition: opacity 0.3s, transform 0.3s; }
.status-enter-from { opacity: 0; transform: translateY(4px); }
.status-leave-to   { opacity: 0; transform: translateY(-4px); }
</style>
