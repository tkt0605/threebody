import type { LevelConfig } from './types'

export const M = {
  anthropic: {
    fast:     process.env.ANTHROPIC_MODEL_FAST!,
    balanced: process.env.ANTHROPIC_MODEL_BALANCED!,
    powerful: process.env.ANTHROPIC_MODEL_POWERFUL!,
  },
  openai: {
    fast:     process.env.OPENAI_MODEL_FAST!,
    balanced: process.env.OPENAI_MODEL_BALANCED!,
    powerful: process.env.OPENAI_MODEL_POWERFUL!,
  },
  deepseek: {
    fast:     process.env.DEEPSEEK_MODEL_FAST!,
    powerful: process.env.DEEPSEEK_MODEL_POWERFUL!,
  },
  ollama: {
    default:  process.env.OLLAMA_MODEL_DEFAULT!,
  },
}

export const LEVEL_CONFIG: Record<number, LevelConfig> = {
  1: { anthropicModel: M.anthropic.fast,     openaiModel: M.openai.fast,     deepseekModel: M.deepseek.fast,     ollamaModel: M.ollama.default, maxTokens: 2048,  secondaryMaxTokens: 512 },
  2: { anthropicModel: M.anthropic.fast,     openaiModel: M.openai.fast,     deepseekModel: M.deepseek.fast,     ollamaModel: M.ollama.default, maxTokens: 4096,  secondaryMaxTokens: 768 },
  3: { anthropicModel: M.anthropic.balanced, openaiModel: M.openai.balanced, deepseekModel: M.deepseek.fast,     ollamaModel: M.ollama.default, maxTokens: 8192,  secondaryMaxTokens: 1536 },
  4: { anthropicModel: M.anthropic.balanced, openaiModel: M.openai.balanced, deepseekModel: M.deepseek.powerful, ollamaModel: M.ollama.default, maxTokens: 16000, secondaryMaxTokens: 3072, thinkingBudget: 8000 },
  5: { anthropicModel: M.anthropic.powerful, openaiModel: M.openai.powerful, deepseekModel: M.deepseek.powerful, ollamaModel: M.ollama.default, maxTokens: 32000, secondaryMaxTokens: 6144, adaptiveThinking: true },
}
