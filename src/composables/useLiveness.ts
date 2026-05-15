import { ref, computed } from 'vue'

export type Challenge = 'turnFace' | 'turnRight' | 'turnLeft' | 'nod'

export const CHALLENGE_LABELS: Record<Challenge, string> = {
  turnFace:  '首を回してください',
  turnRight: '右を向いてください',
  turnLeft:  '左を向いてください',
  nod:       'うなずいてください',
}

type Pt = { x: number; y: number }

function dist(a: Pt, b: Pt): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

// 口のアスペクト比：縦距離 / 横距離
function mouthAspectRatio(p: Pt[]): number {
  const vertical   = (dist(p[61]!, p[67]!) + dist(p[62]!, p[66]!) + dist(p[63]!, p[65]!)) / 3
  const horizontal = dist(p[48]!, p[54]!)
  return vertical / horizontal
}

export function useLiveness() {
  const queue        = ref<Challenge[]>([])
  const currentIndex = ref(0)
  const completed    = ref(false)

  let mouthOpen   = false
  let openFrames  = 0
  let baseX: number | null = null
  let baseY: number | null = null
  let nodding     = false

  const current      = computed(() => queue.value[currentIndex.value] ?? null)
  const currentLabel = computed(() => current.value ? CHALLENGE_LABELS[current.value] : '')
  const progress     = computed(() => `${Math.min(currentIndex.value + 1, queue.value.length)} / ${queue.value.length}`)

  function init() {
    const all: Challenge[] = ['turnFace', 'turnRight', 'turnLeft', 'nod']
    queue.value        = [...all].sort(() => Math.random() - 0.5).slice(0, 2)
    currentIndex.value = 0
    completed.value    = false
    resetState()
  }

  function resetState() {
    mouthOpen  = false
    openFrames = 0
    baseX      = null
    baseY      = null
    nodding    = false
  }

  function advance() {
    resetState()
    currentIndex.value++
    if (currentIndex.value >= queue.value.length) completed.value = true
  }

  function processFace(landmarks: { positions: Pt[] }): void {
    if (completed.value) return
    const p  = landmarks.positions
    const ch = current.value
    if (!ch) return



    if (ch === 'turnFace') {
      const mar = mouthAspectRatio(p)
      // 3フレーム連続でMAR > 0.35 = 口が開いている
      if (!mouthOpen) {
        if (mar > 0.35) { openFrames++; if (openFrames >= 3) mouthOpen = true }
        else openFrames = 0
      } else if (mar < 0.20) {
        // 口を閉じたら完了
        advance()
      }
      return
    }

    if (ch === 'turnRight' || ch === 'turnLeft') {
      const faceW  = p[16]!.x - p[0]!.x
      const cx     = (p[0]!.x + p[16]!.x) / 2
      const offset = (p[30]!.x - cx) / faceW
      if (baseX === null) { baseX = offset; return }
      const delta = offset - baseX
      if (ch === 'turnRight' && delta >  0.18) advance()
      if (ch === 'turnLeft'  && delta < -0.18) advance()
      return
    }

    if (ch === 'nod') {
      const faceH = p[8]!.y - p[27]!.y
      const relY  = (p[30]!.y - p[27]!.y) / faceH
      if (baseY === null) { baseY = relY; return }
      const delta = relY - baseY
      if (!nodding && delta > 0.08) nodding = true
      if (nodding  && delta < 0.02) advance()
    }
  }

  return { current, currentLabel, progress, completed, init, processFace }
}
