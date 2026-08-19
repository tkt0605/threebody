export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'

export type BodyProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek'

// 副体が担当する「答える対象」。態度の違いではなく、それぞれ別の問いに答える
// （文面と割り当ては llm/secondaryPrompt.ts）
export type SecondaryRole = 'optimist' | 'skeptic' | 'realist'

export interface BodyConfig {
  provider: BodyProvider
  apiKey:   string
  model:    string
  // 副体の表示名は role から backend が決める（フロントから受け取らない）。
  // 主体だけは呼称を持つが SSE には出ないため、ここでは扱わない
  // 副体の system はこの role から backend が組む。フロントから文面（旧 personaPrompt）は
  // 受け取らない — 同じ指示が2箇所にあると、片方だけ古くなるため
  role?: SecondaryRole
}

export type LevelConfig = {
  anthropicModel:     string
  openaiModel:        string
  deepseekModel:      string
  ollamaModel:        string
  maxTokens:          number
  secondaryMaxTokens: number  // 三体モードの副体（見解）用。主体に統合される前提のため主体より少なめ
  thinkingBudget?:    number  // Sonnet 4.6 以下で使用（deprecated だが機能はする）
  adaptiveThinking?:  boolean // Opus 4.7 専用（budget_tokens は 400 になるため）
}
