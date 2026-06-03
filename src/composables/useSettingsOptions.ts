import type { VoiceStyle, Preset } from './useSettings'

export const VOICE_STYLE_OPTIONS: { value: VoiceStyle; label: string; desc: string }[] = [
  { value: 'formal', label: '丁寧',   desc: '自然な敬語' },
  { value: 'casual', label: 'タメ口', desc: '友達感覚' },
  { value: 'terse',  label: '端的',   desc: '無駄なし' },
  { value: 'warm',   label: '温かい', desc: '共感重視' },
]

export const PRESET_OPTIONS: { value: Preset; label: string; desc: string }[] = [
  { value: 'general',  label: '汎用',   desc: 'デフォルト' },
  { value: 'coding',   label: 'コード', desc: 'プログラミング' },
  { value: 'creative', label: '創作',   desc: 'アイデア・物語' },
  { value: 'chat',     label: '雑談',   desc: 'カジュアル' },
]
