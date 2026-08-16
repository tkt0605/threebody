import type { VoiceStyle } from './useSettings'

export const VOICE_STYLE_OPTIONS: { value: VoiceStyle; label: string; desc: string }[] = [
  { value: 'formal', label: '丁寧',   desc: '自然な敬語' },
  { value: 'casual', label: 'タメ口', desc: '友達感覚' },
  { value: 'terse',  label: '端的',   desc: '無駄なし' },
  { value: 'warm',   label: '温かい', desc: '共感重視' },
]
