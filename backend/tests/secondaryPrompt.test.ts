import { describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import {
  buildSecondaryMessages, buildSecondarySystemPrompt, needsMultiBody,
  resolveSecondaryRole, secondaryRoleLabel,
} from '../llm/secondaryPrompt'

const text = (m: OpenAI.Chat.ChatCompletionMessageParam) =>
  typeof m.content === 'string' ? m.content : ''

describe('buildSecondarySystemPrompt', () => {
  // 副体2体が同じことを言う原因は、態度（楽観/懐疑）の違いしか無かったこと。
  // 役ごとに「答える対象」そのものを変えているのを固定する
  it('役ごとに別の見出しを要求する（同じ答えが返る余地を無くす）', () => {
    const skeptic  = buildSecondarySystemPrompt('skeptic')
    const optimist = buildSecondarySystemPrompt('optimist')
    const realist  = buildSecondarySystemPrompt('realist')

    expect(skeptic).toContain('崩れる点:')
    expect(optimist).toContain('別の見方:')
    expect(realist).toContain('最初の一手:')

    expect(skeptic).not.toContain('別の見方:')
    expect(optimist).not.toContain('崩れる点:')
    expect(realist).not.toContain('崩れる点:')
  })

  // 「なるほど」で始めて普通に回答していたのは、会話人格（アイリス）の
  // 「相槌は『なるほど』」がそのまま副体に渡っていたため
  it('会話としての受け答えと、問い全体への回答を禁じる', () => {
    const prompt = buildSecondarySystemPrompt('skeptic')

    expect(prompt).toContain('ユーザーではない')
    expect(prompt).toContain('問い全体への答えを書かない')
    expect(prompt).toContain('なるほど')  // 禁止語として挙げている側
    // 事実の規律は層1（CORE_PRINCIPLES）へ移した。副体にも必ず被っていること
    expect(prompt).toContain('知らないことは知らないと書く')
    expect(prompt).toContain('確認していない前提があれば「未確認: ○○」と続ける')
  })
})

describe('buildSecondaryMessages', () => {
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user',      content: '最初の質問' },
    { role: 'assistant', content: `${'古い回答。'.repeat(200)}` },
    { role: 'user',      content: '同じことをもう一度聞く。設計はどうする？' },
  ]

  // 繰り返し聞くほど答えが薄くなっていたのは、履歴に主体の過去回答が積まれ、
  // 副体がそれを読んで「すでに述べたとおり」の側へ逃げていたため
  it('履歴を user 1件へ畳み、直前の問いは冒頭だけ渡す', () => {
    const msgs = buildSecondaryMessages(history, 'skeptic')

    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('user')
    expect(text(msgs[0]!)).toContain('同じことをもう一度聞く')
    expect(text(msgs[0]!)).toContain('【直前の問い】')
    expect(text(msgs[0]!)).toContain('最初の質問')
    expect(text(msgs[0]!).length).toBeLessThan(700)
  })

  // 主体が一度間違えた固有名を副体が復唱し、それを主体がまた採る閉ループを断つ。
  // 渡してよいのはユーザー自身の言葉（問い）だけで、検証されていない回答は渡さない
  it('直前の「回答」は一切渡さない（誤った固有名が世代を超えて増殖する経路）', () => {
    const contaminated: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user',      content: '6か国の教育支出をまとめて' },
      { role: 'assistant', content: 'OECDのEDUstatsデータベースを参照してください。' },
      { role: 'user',      content: 'もっと詳しく' },
    ]
    const body = text(buildSecondaryMessages(contaminated, 'realist')[0]!)

    expect(body).not.toContain('EDUstats')
    expect(body).not.toContain('OECD')
    expect(body).toContain('6か国の教育支出をまとめて')
  })

  it('作業指示を user ターンにも置く（小さいモデルは system より直近に従う）', () => {
    expect(text(buildSecondaryMessages(history, 'realist')[0]!)).toContain('【あなたの作業】')
    expect(text(buildSecondaryMessages(history, 'realist')[0]!)).toContain('今日から着手できる')
    expect(text(buildSecondaryMessages(history, 'skeptic')[0]!)).toContain('失敗しやすい箇所')
  })

  it('1往復目は「直前の問い」を付けない', () => {
    const msgs = buildSecondaryMessages([{ role: 'user', content: '設計はどうする？' }], 'skeptic')
    expect(text(msgs[0]!)).not.toContain('【直前の問い】')
  })
})

describe('needsMultiBody', () => {
  it('挨拶や相槌では副体を呼ばない', () => {
    for (const t of ['おはよう', 'ありがとう', 'うん、そうだね', '了解']) {
      expect(needsMultiBody([{ role: 'user', content: t }])).toBe(false)
    }
  })

  it('疑問符があれば短くても呼ぶ', () => {
    expect(needsMultiBody([{ role: 'user', content: 'なぜ？' }])).toBe(true)
  })

  it('中身のある依頼は疑問符が無くても呼ぶ', () => {
    expect(needsMultiBody([{ role: 'user', content: 'WebSocketを使うチャットアプリを作りたい' }])).toBe(true)
  })
})

describe('resolveSecondaryRole', () => {
  // 古いフロント（personaPrompt を送っていた頃のバンドル）や curl から来た
  // リクエストでも、副体2体に別々の役が当たること
  it('role が無ければ並び順で別々の役を割り当てる', () => {
    expect(resolveSecondaryRole(undefined, 0)).not.toBe(resolveSecondaryRole(undefined, 1))
  })

  it('未知の値は既定の役へ落とす', () => {
    expect(secondaryRoleLabel(resolveSecondaryRole('unknown-role', 0))).toBe('崩れる点')
  })
})
