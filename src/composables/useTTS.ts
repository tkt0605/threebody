import { ref } from 'vue'
import { stripMarkdown } from '../lib/stripMarkdown'

// 品質の高い日本語音声を優先順で選ぶ
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const langPrefix = lang.slice(0, 2)
  const candidates = voices.filter(v => v.lang.startsWith(langPrefix))
  const priority = ['Google', 'Microsoft', 'Apple']
  for (const vendor of priority) {
    const v = candidates.find(v => v.name.includes(vendor))
    if (v) return v
  }
  return candidates[0] ?? null
}

// onIdle は「積んであったものを全部喋り終えた」ときに呼ばれる。
// 文ごとの onend ではなくキューが空になった瞬間なので、逐次読み上げの途中では鳴らない
export function useTTS(onIdle?: () => void) {
  const speaking  = ref(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  // 再生待ち・再生中の発話数。SpeechSynthesis 自体がキューを持つので、
  // ここでは「まだ喋り終わっていないものがあるか」だけを数える。
  // 文ごとに onend が来るため、数えないと文の切れ目で speaking が
  // 一瞬 false になり、「読み上げが終わった」と誤検知される
  let pending = 0

  // 応答全体ではなく、文が1つ完成するたびに呼ぶ。
  // 既存の再生を止めないので、呼んだ順にそのまま繋がって喋られる
  function enqueue(text: string, lang = 'ja-JP'): void {
    const spoken = stripMarkdown(text)
    if (!supported || !spoken.trim()) {
      // 読み上げるものが無いのに待たせない。既に何も鳴っていなければ即座に「終わった」扱い
      if (pending === 0) onIdle?.()
      return
    }

    const u  = new SpeechSynthesisUtterance(spoken)
    u.lang   = lang
    u.voice  = pickVoice(lang)
    u.rate   = 1.0
    u.pitch  = 1.05
    u.volume = 1.0

    const done = () => {
      pending = Math.max(0, pending - 1)
      if (pending === 0) {
        speaking.value = false
        onIdle?.()
      }
    }
    u.onstart = () => { speaking.value = true }
    u.onend   = done
    u.onerror = done

    pending += 1
    speaking.value = true
    window.speechSynthesis.speak(u)
  }

  // 再生中のものも待機中のものも破棄する（停止・バージイン用）
  function cancel(): void {
    if (supported) window.speechSynthesis.cancel()
    pending = 0
    speaking.value = false
  }

  return { speaking, supported, enqueue, cancel }
}
