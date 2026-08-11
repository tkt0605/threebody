import { describe, it, expect, beforeEach, vi } from 'vitest'
import type express from 'express'
import type OpenAI from 'openai'
import type { BodyConfig, LevelConfig } from '../llm/types'
import { orchestrateMultiBody } from '../llm/textService'
import { streamOllamaNative } from '../llm/providers/ollama'

// 三体オーケストレーションの分岐だけを検証したいので、実際のLLM呼び出しは差し替える。
// 全ての体を ollama にすることで、副体（streamSecondaryBody）と主体（streamBodyOAI）の
// 両方がこの1つのモックを通る
vi.mock('../llm/providers/ollama', () => ({ streamOllamaNative: vi.fn() }))

// providers/anthropic.ts はモジュール読み込み時に new Anthropic() を実行するが、
// vitest の jsdom 環境では「ブラウザ相当」と判定されて例外になる。
// このテストは ollama の体しか使わないため、丸ごと差し替えて読み込みを回避する
vi.mock('../llm/providers/anthropic', () => ({ streamAnthropic: vi.fn() }))

type SSEEvent = { type: string; bodyIndex?: number; content?: string }

// res.write に流れたSSE行を、テストから読める形に解いておく
function fakeRes() {
  const events: SSEEvent[] = []
  const write = vi.fn((chunk: string) => {
    const payload = chunk.replace(/^data: /, '').trim()
    if (payload === '[DONE]') return true
    try { events.push(JSON.parse(payload) as SSEEvent) } catch { /* [DONE]以外の非JSONは想定しない */ }
    return true
  })
  return { res: { write } as unknown as express.Response, events }
}

const CONFIG: LevelConfig = {
  anthropicModel: 'claude-haiku-4-5', openaiModel: 'gpt-x', deepseekModel: 'ds-x', ollamaModel: 'gemma',
  maxTokens: 4096, secondaryMaxTokens: 768,
}

const MESSAGES: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'user', content: 'こんにちは' }]

function bodies(): BodyConfig[] {
  return [
    { provider: 'ollama', apiKey: '', model: 'primary-model',   name: '一体' },
    { provider: 'ollama', apiKey: '', model: 'secondary-a',     name: '二体' },
    { provider: 'ollama', apiKey: '', model: 'secondary-b',     name: '三体' },
  ]
}

// モデル名ごとに「正常に喋る」か「throwする」かを決める
function mockByModel(behavior: Record<string, string | Error>) {
  vi.mocked(streamOllamaNative).mockImplementation(
    async (model: string, _msgs, _maxTokens, onContent: (t: string) => void) => {
      const result = behavior[model]
      if (result instanceof Error) throw result
      onContent(result ?? '')
    }
  )
}

describe('orchestrateMultiBody', () => {
  beforeEach(() => {
    vi.mocked(streamOllamaNative).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('副体が1体失敗しても、残りの見解で統合まで到達する', async () => {
    // Promise.all のままだと、ここで三体の見解も主体の統合もまるごと失われていた
    mockByModel({
      'secondary-a': new Error('provider is down'),
      'secondary-b': '三体の見解です',
      'primary-model': '統合された回答',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    // 主体の統合が実行されている（＝全滅していない）
    expect(events.some(e => e.type === 'synthesis_start')).toBe(true)
    expect(events.filter(e => e.type === 'text').map(e => e.content).join('')).toBe('統合された回答')
  })

  it('失敗した副体にも body_done を送る（球体が分裂したまま固まるのを防ぐ）', async () => {
    mockByModel({
      'secondary-a': new Error('boom'),
      'secondary-b': '三体の見解です',
      'primary-model': '統合',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    // 失敗した二体(bodyIndex:1)・成功した三体(bodyIndex:2)の両方に body_done が来る
    const doneIndexes = events.filter(e => e.type === 'body_done').map(e => e.bodyIndex).sort()
    expect(doneIndexes).toEqual([1, 2])
  })

  it('失敗した副体の見解は統合プロンプトに混ぜない', async () => {
    mockByModel({
      'secondary-a': new Error('boom'),
      'secondary-b': '三体の見解です',
      'primary-model': '統合',
    })
    const { res } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    // 主体（primary-model）に渡ったメッセージを取り出す
    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    const sentText = JSON.stringify(primaryCall[1])
    expect(sentText).toContain('三体の見解です')
    expect(sentText).not.toContain('二体')
  })

  it('副体が全滅したら単体モードに縮退する（空の見解を注入しない）', async () => {
    mockByModel({
      'secondary-a': new Error('boom'),
      'secondary-b': new Error('boom'),
      'primary-model': '単体としての回答',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(events.filter(e => e.type === 'text').map(e => e.content).join('')).toBe('単体としての回答')

    // 「以下は他の体の見解です」という空振りの指示を主体に渡していないこと
    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    expect(JSON.stringify(primaryCall[1])).not.toContain('他の体（LLM）の見解')
  })

  it('全副体が成功する通常ケースでは、両方の見解が統合に渡る', async () => {
    mockByModel({
      'secondary-a': '二体の見解です',
      'secondary-b': '三体の見解です',
      'primary-model': '統合',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(events.filter(e => e.type === 'body_start')).toHaveLength(2)
    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    const sentText = JSON.stringify(primaryCall[1])
    expect(sentText).toContain('二体の見解です')
    expect(sentText).toContain('三体の見解です')
  })
})
