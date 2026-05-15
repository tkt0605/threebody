import { ref, computed } from 'vue'

export type Challenge = 'blink' | 'turnRight' | 'turnLeft' | 'nod'

export const CHALLENGE_LABELS: Record<Challenge, string> = {
  blink:     '目をつぶってください',
  turnRight: '右を向いてください',
  turnLeft:  '左を向いてください',
  nod:       'うなずいてください',
}

type Pt = { x: number; y: number }

function dist(a: Pt, b: Pt): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function eyeAspectRatio(pts: Pt[]): number {
  return (dist(pts[1], pts[5]) + dist(pts[2], pts[4])) / (2 * dist(pts[0], pts[3]))
}

export function useLiveness() {
  const queue        = ref<Challenge[]>([])
  const currentIndex = ref(0)
  const completed    = ref(false)

  let eyesClosed = false
  let baseX: number | null = null
  let baseY: number | null = null
  let nodding   = false

  const current      = computed(() => queue.value[currentIndex.value] ?? null)
  const currentLabel = computed(() => current.value ? CHALLENGE_LABELS[current.value] : '')
  const progress     = computed(() => `${Math.min(currentIndex.value + 1, queue.value.length)} / ${queue.value.length}`)

  function init() {
    const all: Challenge[] = ['blink', 'turnRight', 'turnLeft', 'nod']
    queue.value        = [...all].sort(() => Math.random() - 0.5).slice(0, 2)
    currentIndex.value = 0
    completed.value    = false
    resetState()
  }

  function resetState() {
    eyesClosed = false
    baseX      = null
    baseY      = null
    nodding    = false
  }

  function advance() {
    resetState()
    currentIndex.value++
    if (currentIndex.value >= queue.value.length) completed.value = true
  }

  // landmarks.positions は face-api.js の 68点ランドマーク配列
  function processFace(landmarks: { positions: Pt[] }): void {
    if (completed.value) return
    const p  = landmarks.positions
    const ch = current.value
    if (!ch) return

    if (ch === 'blink') {
      const leftEAR  = eyeAspectRatio([p[36], p[37], p[38], p[39], p[40], p[41]])
      const rightEAR = eyeAspectRatio([p[42], p[43], p[44], p[45], p[46], p[47]])
      const avg      = (leftEAR + rightEAR) / 2
      if (!eyesClosed && avg < 0.20) eyesClosed = true
      else if (eyesClosed && avg > 0.26) advance()
      return
    }

    if (ch === 'turnRight' || ch === 'turnLeft') {
      const faceW  = p[16].x - p[0].x
      const cx     = (p[0].x + p[16].x) / 2
      const offset = (p[30].x - cx) / faceW
      if (baseX === null) { baseX = offset; return }
      const delta = offset - baseX
      if (ch === 'turnRight' && delta >  0.18) advance()
      if (ch === 'turnLeft'  && delta < -0.18) advance()
      return
    }

    if (ch === 'nod') {
      const faceH = p[8].y - p[27].y
      const relY  = (p[30].y - p[27].y) / faceH
      if (baseY === null) { baseY = relY; return }
      const delta = relY - baseY
      if (!nodding && delta > 0.08) nodding = true
      if (nodding  && delta < 0.02) advance()
    }
  }

  return { current, currentLabel, progress, completed, init, processFace }
}
