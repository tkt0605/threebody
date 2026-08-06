import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ollamaEnabled } from '../llm/providers/ollama'

describe('ollamaEnabled', () => {
  const saved = process.env.OLLAMA_ENABLED

  beforeEach(() => { delete process.env.OLLAMA_ENABLED })
  afterEach(() => {
    if (saved === undefined) delete process.env.OLLAMA_ENABLED
    else process.env.OLLAMA_ENABLED = saved
  })

  it('未設定なら true（ローカル開発の既存動作を壊さない既定値）', () => {
    expect(ollamaEnabled()).toBe(true)
  })

  it('"false" なら false', () => {
    process.env.OLLAMA_ENABLED = 'false'
    expect(ollamaEnabled()).toBe(false)
  })

  it('"0" なら false', () => {
    process.env.OLLAMA_ENABLED = '0'
    expect(ollamaEnabled()).toBe(false)
  })

  it('大文字・空白混じりの "FALSE" でも false', () => {
    process.env.OLLAMA_ENABLED = '  FALSE  '
    expect(ollamaEnabled()).toBe(false)
  })

  it('"true" や無関係な値なら true', () => {
    process.env.OLLAMA_ENABLED = 'true'
    expect(ollamaEnabled()).toBe(true)
    process.env.OLLAMA_ENABLED = 'yes'
    expect(ollamaEnabled()).toBe(true)
  })
})
