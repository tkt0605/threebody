import { ref } from 'vue'

export function useTTS() {
  const speaking  = ref(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  function speak(text: string, lang = 'ja-JP', onDone?: () => void) {
    if (!supported || !text.trim()) {
      onDone?.()
      return
    }
    window.speechSynthesis.cancel()
    const u  = new SpeechSynthesisUtterance(text)
    u.lang   = lang
    u.rate   = 1.05
    u.pitch  = 1.0
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
