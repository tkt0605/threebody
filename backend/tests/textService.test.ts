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

type SSEEvent = { type: string; bodyIndex?: number; content?: string; name?: string; review?: boolean; hasFinding?: boolean }

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

// 割れる余地のある問い。挨拶や相槌は needsMultiBody が副体を呼ぶ前に落とすため、
// 「検算まで走ること」を見たいテストの問いは中身のあるものにする
const MESSAGES: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'Pinterestのような画像共有サービスはどう設計する？' },
]

// 副体の表示名・指示は role から backend が組む（フロントは role しか送らない）。
// secondary-a = skeptic（崩れる点）、secondary-b = realist（抜けている点）
function bodies(): BodyConfig[] {
  return [
    { provider: 'ollama', apiKey: '', model: 'primary-model' },
    { provider: 'ollama', apiKey: '', model: 'secondary-a', role: 'skeptic' },
    { provider: 'ollama', apiKey: '', model: 'secondary-b', role: 'realist' },
  ]
}

// 答えが REVIEW_MIN_CHARS に満たないと検算へ回らないため、
// 「検算が走ること」を見たいテストの答えはこの長さまで伸ばす
function long(head: string): string {
  return `${head}\n${'方針としては段階的に進めるのが良いと考えます。'.repeat(6)}`
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

const sentTo = (model: string) =>
  JSON.stringify(vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === model)![1])

describe('orchestrateMultiBody', () => {
  beforeEach(() => {
    vi.mocked(streamOllamaNative).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  // 設計の要点。主体が先に答え、その答えを副体が読む。
  // 逆順（副体の見解を主体が統合する）だと、主体は「答える」と「まとめる」の二役を負い、
  // 単体なら出ていた観点が平均 1.2/run 落ちていた（docs/chat_see.log）
  it('主体が先に答え、その答えが副体へ渡る', async () => {
    mockByModel({
      'primary-model': long('画像共有サービスの設計はこうです。'),
      'secondary-a': '崩れる点: ...',
      'secondary-b': '抜けている点: ...',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    const order = events.map(e => e.type)
    expect(order.indexOf('answer_start')).toBeLessThan(order.indexOf('text'))
    expect(order.indexOf('answer_done')).toBeLessThan(order.indexOf('body_start'))

    // 副体は主体の答えを読んでいる
    expect(sentTo('secondary-a')).toContain('画像共有サービスの設計はこうです。')
    expect(sentTo('secondary-b')).toContain('画像共有サービスの設計はこうです。')
  })

  // 本文はカードより先に完成する。読み上げ（ChatView → useVoiceNarration）は
  // この印で締めるので、検算が終わるまで最後の一文を待たされない
  it('検算に回すときは answer_done に review:true を載せる', async () => {
    mockByModel({ 'primary-model': long('答え'), 'secondary-a': '崩れる点', 'secondary-b': '抜けている点' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(events.find(e => e.type === 'answer_done')?.review).toBe(true)
  })

  it('主体には他の体の存在を一切渡さない（統合層が無いこと）', async () => {
    mockByModel({ 'primary-model': long('答え'), 'secondary-a': '崩れる点', 'secondary-b': '抜けている点' })
    const { res } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    const sent = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')![1] as
      { role: string; content: string }[]
    // toOllamaMessages が systemPrompt を role:'system' の先頭要素として積む。
    // 単体モードとまったく同じ、渡された人格そのものであること
    expect(sent[0]!.role).toBe('system')
    expect(sent[0]!.content).toBe('システム')
    expect(JSON.stringify(sent)).not.toContain('検討メモ')
    expect(JSON.stringify(sent)).not.toContain('他の体')
  })

  // 本文はこの時点で既にユーザーへ届いている。副体の失敗はカードが1枚欠けるだけに留まる
  it('副体が1体失敗しても、本文と残りのカードは残る', async () => {
    mockByModel({
      'primary-model': long('答え'),
      'secondary-a': new Error('provider is down'),
      'secondary-b': '抜けている点: 認証の設計',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(events.filter(e => e.type === 'text').map(e => e.content).join('')).toContain('答え')
    expect(events.filter(e => e.type === 'body_text').map(e => e.content).join('')).toContain('認証の設計')
  })

  it('失敗した副体にも body_done を送る（球体が分裂したまま固まるのを防ぐ）', async () => {
    mockByModel({ 'primary-model': long('答え'), 'secondary-a': new Error('boom'), 'secondary-b': '抜けている点' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    const doneIndexes = events.filter(e => e.type === 'body_done').map(e => e.bodyIndex).sort()
    expect(doneIndexes).toEqual([1, 2])
  })

  // 「指摘が出たか」を読む側が本文の文字列から判定すると、文面が揺れた瞬間に静かに壊れる。
  // 判定は backend で済ませ、body_done に真偽値として載せる
  it('body_done に hasFinding を載せる（指摘あり / 指摘なし）', async () => {
    mockByModel({
      'primary-model': long('答え'),
      'secondary-a': '崩れる点: 出典が未確認\nなぜ: …\n確度: 中',
      'secondary-b': '指摘なし',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    const done = events.filter(e => e.type === 'body_done')
    expect(done.find(e => e.bodyIndex === 1)?.hasFinding).toBe(true)
    expect(done.find(e => e.bodyIndex === 2)?.hasFinding).toBe(false)
  })

  // 落ちた副体は「指摘が無かった」のではなくカードが欠けた状態だが、
  // 指摘が出ていないことに変わりはないので false 側に倒す
  it('失敗した副体の hasFinding は false', async () => {
    mockByModel({ 'primary-model': long('答え'), 'secondary-a': new Error('boom'), 'secondary-b': '抜けている点: 認証' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(events.find(e => e.type === 'body_done' && e.bodyIndex === 1)?.hasFinding).toBe(false)
  })

  // 「おはよう。」に崩れる点は無い。問いの側（needsMultiBody）で落とせない場合でも、
  // 答えが一言で済んだターンは検算に回さない
  it('答えが短すぎるときは検算しない', async () => {
    mockByModel({ 'primary-model': 'はい。', 'secondary-a': '崩れる点', 'secondary-b': '抜けている点' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(events.filter(e => e.type === 'body_start')).toHaveLength(0)
    expect(events.find(e => e.type === 'answer_done')?.review).toBe(false)
    expect(vi.mocked(streamOllamaNative).mock.calls.map(c => c[0])).toEqual(['primary-model'])
  })

  it('挨拶では副体を呼ばず、主体だけで答える', async () => {
    mockByModel({ 'primary-model': long('おはよう。'), 'secondary-a': '崩れる点', 'secondary-b': '抜けている点' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, [{ role: 'user', content: 'おはよう' }], CONFIG, 'システム', res)

    expect(events.filter(e => e.type === 'body_start')).toHaveLength(0)
    expect(vi.mocked(streamOllamaNative).mock.calls.map(c => c[0])).toEqual(['primary-model'])
  })

  // 副体が「なるほど」で始めて普通に回答していたのは、主体と同じ会話人格と履歴を
  // 渡していたため。副体には検算用の system と、問い・答えだけを渡す
  it('副体には会話人格も履歴全文も渡さない（渡すのは問いと答えだけ）', async () => {
    mockByModel({ 'primary-model': long('新しい答え'), 'secondary-a': '崩れる点', 'secondary-b': '抜けている点' })
    const { res } = fakeRes()
    const all = bodies()
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user',      content: '前の質問' },
      { role: 'assistant', content: `主体の過去の回答。${'この続きは副体に渡らない。'.repeat(40)}` },
      { role: 'user',      content: 'Pinterestのような画像共有サービスはどう設計する？' },
    ]

    await orchestrateMultiBody(all, all, history, CONFIG, 'アイリスとしての会話人格', res)

    expect(sentTo('primary-model')).toContain('アイリスとしての会話人格')
    expect(sentTo('secondary-a')).not.toContain('アイリスとしての会話人格')
    // 検算の対象は「今の答え」だけ。過去のターンは渡さない
    expect(sentTo('secondary-a')).not.toContain('主体の過去の回答')
    expect(sentTo('secondary-a')).not.toContain('前の質問')
    expect(sentTo('secondary-a')).toContain('どう設計する')
    expect(sentTo('secondary-a')).toContain('新しい答え')
  })

  it('副体2体には別々の作業が渡る（同じ指摘が返る余地を無くす）', async () => {
    mockByModel({ 'primary-model': long('答え'), 'secondary-a': '崩れる点', 'secondary-b': '抜けている点' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    expect(sentTo('secondary-a')).toContain('崩れやすい箇所')
    expect(sentTo('secondary-b')).toContain('答えに書かれていない点')
    expect(sentTo('secondary-a')).not.toContain('答えに書かれていない点')

    // カードの見出しも役ごとに変わる（何を見た指摘なのかが一目で分かる）
    expect(events.filter(e => e.type === 'body_start').map(e => e.name))
      .toEqual(['崩れる点', '抜けている点'])
  })
})
