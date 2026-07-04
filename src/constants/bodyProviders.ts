import type { BodyProvider } from '../composables/useSettings'

export const BODY_PROVIDER_COLORS: Record<BodyProvider, string> = {
  ollama:    '#22c55e',
  openai:    '#0ea5e9',
  anthropic: '#f97316',
  deepseek:  '#8b5cf6',
}

// 役割（一体/二体/三体）別のカラー。bodyIndex（設定上のスロット番号）でインデックス
export const BODY_ROLE_COLORS = ['#f87171', '#60a5fa', '#4ade80'] as const
