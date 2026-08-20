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

// 割れる余地のある問い。挨拶や相槌は needsMultiBody が副体を呼ぶ前に落とすため、
// 「統合まで走ること」を見たいテストの問いは中身のあるものにする
const MESSAGES: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'Pinterestのような画像共有サービスはどう設計する？' },
]

// 副体の表示名・指示は role から backend が組む（フロントは role しか送らない）。
// secondary-a = skeptic（崩れる点）、secondary-b = realist（最初の一手）
function bodies(): BodyConfig[] {
  return [
    { provider: 'ollama', apiKey: '', model: 'primary-model' },
    { provider: 'ollama', apiKey: '', model: 'secondary-a', role: 'skeptic' },
    { provider: 'ollama', apiKey: '', model: 'secondary-b', role: 'realist' },
  ]
}

// 見解が短すぎると統合せず単体モードに縮退する（SYNTHESIS_MIN_CHARS）ため、
// 「統合が走ること」を見たいテストの見解は、中身のある回答と同じ分量まで伸ばす。
// 短い見解そのものの挙動は専用のテストで見る
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

describe('orchestrateMultiBody', () => {
  beforeEach(() => {
    vi.mocked(streamOllamaNative).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('副体が1体失敗しても、残りの見解で統合まで到達する', async () => {
    // Promise.all のままだと、ここで三体の見解も主体の統合もまるごと失われていた
    mockByModel({
      'secondary-a': new Error('provider is down'),
      'secondary-b': long('三体の見解です'),
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
      'secondary-b': long('三体の見解です'),
      'primary-model': '統合',
    })
    const { res } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    // 主体（primary-model）に渡ったメッセージを取り出す
    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    const sentText = JSON.stringify(primaryCall[1])
    expect(sentText).toContain('三体の見解です')
    // 失敗した体の見出しごと出ないこと（ラベル名は統合プロンプトの定型文にも出るため、
    // 見出しの形で確かめる）
    expect(sentText).not.toContain('【崩れる点')
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

    // 存在しない見解について語り出させる【統合タスク】ブロックを渡していないこと
    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    expect(JSON.stringify(primaryCall[1])).not.toContain('【統合タスク】')
  })

  // 挨拶に副体2体を回すと、ほぼ同じ一言が2つ並ぶ。統合すべき差分が無いのに統合させると、
  // 主体は組み立てる材料が無く隣の2文を継ぎ接ぎして日本語を壊す
  // （実測:「どんなことで頭がいっぱい？」＋「どんなことを話したい？」
  //  →「どんなことで頭のなかにある？」と助詞だけ引き写して述語が入れ替わった）
  it('見解が短すぎるとき（挨拶など）は統合せず、主体にそのまま答えさせる', async () => {
    mockByModel({
      'secondary-a': 'おはよう。今日はどんなことで頭がいっぱい？',
      'secondary-b': 'おはよう。今日はどんなことを話したい？',
      'primary-model': 'おはよう。今日はどんなことが頭のなかにある？',
    })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    // 副体は走る（球体の分裂と見解カードは出る）
    expect(events.filter(e => e.type === 'body_start')).toHaveLength(2)

    // が、主体には見解を渡さない
    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    const sent = JSON.stringify(primaryCall[1])
    expect(sent).not.toContain('【統合タスク】')
    expect(sent).not.toContain('頭がいっぱい')
  })

  it('全副体が成功する通常ケースでは、両方の見解が統合に渡る', async () => {
    mockByModel({
      'secondary-a': long('二体の見解です'),
      'secondary-b': long('三体の見解です'),
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

  // 「コードを書くな」は小さいモデルが守らない回がある。
  // 依頼ではなく処理で落としていることを固定する
  it('副体が書いたコードブロックは統合へ渡らない', () => {
    const withCode = `${long('方針はこうです。')}\n\`\`\`python\nprint(1)\n\`\`\`\n以上です。`
    const truncated = `${long('途中まで書きます。')}\n\`\`\`js\nconst a = 1;\nconst b =`   // 生成が切れて閉じていない

    mockByModel({ 'secondary-a': withCode, 'secondary-b': truncated, 'primary-model': '統合' })
    const { res } = fakeRes()
    const all = bodies()

    return orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res).then(() => {
      const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
      const sent = JSON.stringify(primaryCall[1])

      expect(sent).toContain('方針はこうです。')
      expect(sent).toContain('以上です。')
      expect(sent).not.toContain('print(1)')
      // 閉じていないフェンス以降も落とす（書きかけのコードを資料にしない）
      expect(sent).not.toContain('const a = 1')
      expect(sent).not.toContain('```')
    })
  })

  // 挨拶に3つの観点は存在しない。出力形式を固定した副作用として見解の文字数では
  // 挨拶を弾けなくなったため、問いの側で先に落とす（＝呼び出しも2回減る）
  it('挨拶では副体を呼ばず、主体だけで答える', async () => {
    mockByModel({ 'secondary-a': long('見解'), 'secondary-b': long('見解'), 'primary-model': 'おはよう。' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, [{ role: 'user', content: 'おはよう' }], CONFIG, 'システム', res)

    expect(events.filter(e => e.type === 'body_start')).toHaveLength(0)
    expect(vi.mocked(streamOllamaNative).mock.calls.map(c => c[0])).toEqual(['primary-model'])
  })

  // 副体が「なるほど」で始めて普通に回答していたのは、主体と同じ会話人格と履歴を
  // 渡していたため。副体には検討メモ用の system と、直近だけへ畳んだ問いを渡す
  it('副体には会話人格も履歴全文も渡さない', async () => {
    mockByModel({ 'secondary-a': long('見解'), 'secondary-b': long('見解'), 'primary-model': '統合' })
    const { res } = fakeRes()
    const all = bodies()
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user',      content: '前の質問' },
      { role: 'assistant', content: `主体の過去の回答。${'この続きは副体に渡らない。'.repeat(40)}` },
      { role: 'user',      content: 'Pinterestのような画像共有サービスはどう設計する？' },
    ]

    await orchestrateMultiBody(all, all, history, CONFIG, 'アイリスとしての会話人格', res)

    const sent = (model: string) =>
      JSON.stringify(vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === model)![1])

    // 会話人格は主体だけのもの
    expect(sent('primary-model')).toContain('アイリスとしての会話人格')
    expect(sent('secondary-a')).not.toContain('アイリスとしての会話人格')
    // 過去のやり取りは積まない。渡るのは直近の問いと、直前の「問い」の冒頭だけ。
    // 主体の回答は検証されていないので、誤った固有名を副体へ運ばないよう一切渡さない
    expect(sent('secondary-a')).not.toContain('主体の過去の回答')
    expect(sent('secondary-a')).toContain('前の質問')               // 冒頭は文脈として残す
    expect(sent('secondary-a').length).toBeLessThan(sent('primary-model').length)
    expect(sent('secondary-a')).toContain('どう設計する')
  })

  it('副体2体には別々の作業が渡る（同じ答えが返る余地を無くす）', async () => {
    mockByModel({ 'secondary-a': long('見解'), 'secondary-b': long('見解'), 'primary-model': '統合' })
    const { res, events } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    const sent = (model: string) =>
      JSON.stringify(vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === model)![1])

    expect(sent('secondary-a')).toContain('崩れる点:')
    expect(sent('secondary-b')).toContain('最初の一手:')
    expect(sent('secondary-a')).not.toContain('最初の一手:')

    // カードの見出しも役ごとに変わる（同じ問いで割れていることが一目で分かる）
    expect(events.filter(e => e.type === 'body_start').map(e => (e as { name?: string }).name))
      .toEqual(['崩れる点', '最初の一手'])
  })

  // 「見解が渡ること」は上で見ているが、「どこに渡るか」は誰も見ていなかった。
  // user ターンへ連結していたことが、主体が質問に答えず資料に論評する原因だったため、
  // 置き場所そのものを固定する
  it('見解は system 側に入り、user ターンは元の質問のまま渡る', async () => {
    mockByModel({
      'secondary-a': long('二体の見解です'),
      'secondary-b': long('三体の見解です'),
      'primary-model': '統合',
    })
    const { res } = fakeRes()
    const all = bodies()

    await orchestrateMultiBody(all, all, MESSAGES, CONFIG, 'システム', res)

    const primaryCall = vi.mocked(streamOllamaNative).mock.calls.find(c => c[0] === 'primary-model')!
    const sent = primaryCall[1] as { role: string; content: string }[]

    // toOllamaMessages が systemPrompt を role:'system' の先頭要素として積む
    expect(sent[0]!.role).toBe('system')
    expect(sent[0]!.content).toContain('二体の見解です')
    expect(sent[0]!.content).toContain('三体の見解です')

    // user ターンに見解が混ざっていないこと（これが不具合の正体だった）
    const userTurns = sent.filter(m => m.role === 'user')
    expect(userTurns.length).toBeGreaterThan(0)
    expect(userTurns.some(m => m.content.includes('見解です'))).toBe(false)
  })
})
