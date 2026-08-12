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

export function useTTS() {
  const speaking  = ref(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  function speak(text: string, lang = 'ja-JP', onDone?: () => void) {
    if (!supported || !text.trim()) {
      onDone?.()
      return
    }
    window.speechSynthesis.cancel()
    const u  = new SpeechSynthesisUtterance(stripMarkdown(text))
    u.lang   = lang
    u.voice  = pickVoice(lang)
    u.rate   = 1.0
    u.pitch  = 1.05
    u.volume = 1.0
    u.onstart = () => { speaking.value = true }
    u.onend   = () => { speaking.value = false; onDone?.() }
    u.onerror = () => { speaking.value = false; onDone?.() }
    window.speechSynthesis.speak(u)
  }

  function cancel() {
    if (supported) window.speechSynthesis.cancel()
    speaking.value = false
  }

  return { speaking, supported, speak, cancel }
}
