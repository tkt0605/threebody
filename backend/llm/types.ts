export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'ollama'

export type BodyProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek'

export interface BodyConfig {
  provider: BodyProvider
  apiKey:   string
  model:    string
  name?: string
  personaPrompt?: string
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
