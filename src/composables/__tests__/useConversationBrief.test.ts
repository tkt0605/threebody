import { beforeEach, describe, expect, it } from 'vitest'
import {
  useConversationBrief, startConversationBrief, bindConversationBrief,
  openConversationBrief, forgetConversationBrief, clearConversationBriefs,
  openNote,
} from '../useConversationBrief'
import { briefConsultation, briefMarkdown, parseBriefMarkdown, mergeBrief, MAX_BRIEF_FILE_BYTES, briefFields, briefFieldLimits } from '../../lib/conversationBrief'

beforeEach(clearConversationBriefs)

describe('bodyノート', () => {
  it('別のコンポーネントからも同じノートを編集できる', () => {
    useConversationBrief().brief.value.purpose = '実験を決める'
    expect(useConversationBrief().brief.value.purpose).toBe('実験を決める')
  })

  it('初回送信で会話IDが決まってもノートを保持し、別会話と混ぜない', () => {
    const { brief } = useConversationBrief()
    brief.value.purpose = '最初の目的'
    bindConversationBrief('first')
    openConversationBrief('second')
    expect(brief.value.purpose).toBe('')
    brief.value.hypotheses = '別の仮説'
    openConversationBrief('first')
    expect(brief.value.purpose).toBe('最初の目的')
    expect(brief.value.hypotheses).toBe('')
    brief.value.progress = 'done'
    openConversationBrief('second')
    expect(brief.value.hypotheses).toBe('別の仮説')
    expect(brief.value.progress).toBe('planned')
    openConversationBrief('first')
    expect(brief.value.progress).toBe('done')
  })

  it('新規会話は空で始め、元の会話は戻れる', () => {
    const { brief } = useConversationBrief()
    brief.value.decisions = '採用する'
    bindConversationBrief('first')
    startConversationBrief()
    expect(brief.value.decisions).toBe('')
    openConversationBrief('first')
    expect(brief.value.decisions).toBe('採用する')
  })

  it('新規会話で書きかけのノートは、既存会話を見て戻っても残り、会話が作られたら新規側から消える', () => {
    const { brief } = useConversationBrief()
    startConversationBrief()
    brief.value.purpose = '書きかけ'
    openConversationBrief('first')
    expect(brief.value.purpose).toBe('')
    startConversationBrief()
    expect(brief.value.purpose).toBe('書きかけ')
    bindConversationBrief('created')
    startConversationBrief()
    expect(brief.value.purpose).toBe('')
    openConversationBrief('created')
    expect(brief.value.purpose).toBe('書きかけ')
  })

  it('削除やアカウント変更でノートを再表示しない', () => {
    const { brief } = useConversationBrief()
    brief.value.purpose = '秘密'
    bindConversationBrief('first')
    forgetConversationBrief('first')
    openConversationBrief('first')
    expect(brief.value.purpose).toBe('')
    brief.value.purpose = '別の秘密'
    clearConversationBriefs()
    openConversationBrief('first')
    expect(brief.value.purpose).toBe('')
  })

  it('空ノートから相談文を作らず、非空なら判断の種類と完了条件を伝える', () => {
    const { brief } = useConversationBrief()
    expect(briefConsultation(brief.value)).toBe('')
    brief.value.decisions = '既存LLMを使う'
    brief.value.hypotheses = '目的が見えると役立つ'
    brief.value.questions = '音声中に邪魔か'
    brief.value.success = '評価方法が決まる'
    const text = briefConsultation(brief.value)
    expect(text).toContain('## 決定事項\n既存LLMを使う')
    expect(text).toContain('## 仮説\n目的が見えると役立つ')
    expect(text).toContain('## 未決事項\n音声中に邪魔か')
    expect(text).toContain('## 完了条件\n評価方法が決まる')
    expect(text).toContain('仮説を確認済みの事実とせず')
    expect(brief.value.progress).toBe('planned')
  })

  it('持ち出すMarkdownにも本人の進捗と次の一歩を残す', () => {
    const { brief } = useConversationBrief()
    brief.value.nextStep = '三つの場面で試す'
    brief.value.progress = 'working'
    expect(briefMarkdown(brief.value)).toMatch(/^# bodyノート/)
    expect(briefMarkdown(brief.value)).toContain('進捗（本人の判断）: 取り組み中')
    expect(parseBriefMarkdown(briefMarkdown(brief.value)).nextStep).toBe('三つの場面で試す')
  })

  it('保存したMarkdownを読み戻すと同じノートになる', () => {
    const { brief } = useConversationBrief()
    brief.value.purpose = '目的A'
    brief.value.hypotheses = '仮説B\n二行目'
    brief.value.material = '資料C'
    brief.value.progress = 'done'
    const parsed = parseBriefMarkdown(briefMarkdown(brief.value))
    expect(parsed).toEqual({ purpose: '目的A', hypotheses: '仮説B\n二行目', material: '資料C', progress: 'done' })
  })

  it('自作のMarkdownは、欄名と一致する見出しだけ振り分け、題名は捨て、残りは資料へ入れる', () => {
    const parsed = parseBriefMarkdown([
      '# 今日の考えごと',
      '前置きの文',
      '',
      '### 決定事項 ###',
      '- 既存LLMを使う',
      '',
      '## 参考リンク',
      'https://example.com',
      '',
      '進捗: 取り組み中',
      '## 次の一歩',
      '場面を3つ挙げる',
    ].join('\n'))
    expect(parsed.decisions).toBe('- 既存LLMを使う')
    expect(parsed.nextStep).toBe('場面を3つ挙げる')
    expect(parsed.progress).toBe('working')
    expect(parsed.material).toBe('前置きの文\n\n## 参考リンク\nhttps://example.com')
    expect(parsed.purpose).toBeUndefined()
  })

  it('見出しの無いテキストは丸ごと資料になり、CRLF も扱える', () => {
    expect(parseBriefMarkdown('一行目\r\n二行目\r\n')).toEqual({ material: '一行目\n二行目' })
    expect(parseBriefMarkdown('   \n')).toEqual({})
  })

  it('読み込みは既存の欄を消さず追記し、進捗だけ上書きする', () => {
    const { brief } = useConversationBrief()
    brief.value.purpose = '元の目的'
    brief.value.progress = 'planned'
    mergeBrief(brief.value, { purpose: '追加の目的', questions: '新しい未決', progress: 'working' })
    expect(brief.value.purpose).toBe('元の目的\n\n追加の目的')
    expect(brief.value.questions).toBe('新しい未決')
    expect(brief.value.progress).toBe('working')
    mergeBrief(brief.value, { purpose: '   ' })
    expect(brief.value.purpose).toBe('元の目的\n\n追加の目的')
  })

  it('ログアウトで開いたままのダイアログも閉じる', () => {
    const { noteOpen } = useConversationBrief()
    openNote()
    expect(noteOpen.value).toBe(true)
    clearConversationBriefs()
    expect(noteOpen.value).toBe(false)
  })

  it('資料内の見出し・進捗・コードを保存して読み戻しても欄や内容が変わらない', () => {
    const { brief } = useConversationBrief()
    brief.value.material = '# 資料の題名\n## 決定事項\nこれは資料中の引用\n進捗: 完了\n```md\n## 仮説\n```\n~~~~'
    brief.value.hypotheses = '## 未決事項\n本文'
    const parsed = parseBriefMarkdown(briefMarkdown(brief.value))
    expect(parsed.material).toBe(brief.value.material)
    expect(parsed.hypotheses).toBe(brief.value.hypotheses)
    expect(parsed.decisions).toBeUndefined()
    expect(parsed.progress).toBe('planned')
  })

  it('自作Markdownのコード内の見出しや進捗は本文として残す', () => {
    const code = '```md\n## 決定事項\n進捗: 完了\n```'
    expect(parseBriefMarkdown(code)).toEqual({ material: code })
    expect(parseBriefMarkdown('# 題名\n本文\n# 二つ目の章\n続き').material)
      .toBe('本文\n# 二つ目の章\n続き')
  })

  it('文字数超過の読み込みは一部分だけ適用せず、元の全欄を残す', () => {
    const { brief } = useConversationBrief()
    brief.value.purpose = '元の目的'
    expect(() => mergeBrief(brief.value, { purpose: '追記', hypotheses: 'あ'.repeat(2001), progress: 'done' })).toThrow('仮説は2000文字まで')
    expect(brief.value.purpose).toBe('元の目的')
    expect(brief.value.progress).toBe('planned')
  })

  it('各欄の上限まで日本語を入れた保存ファイルも読み込み上限内に収まる', () => {
    const { brief } = useConversationBrief()
    for (const field of briefFields) brief.value[field.key] = 'あ'.repeat(briefFieldLimits[field.key])
    const saved = briefMarkdown(brief.value)
    expect(new TextEncoder().encode(saved).byteLength).toBeLessThan(MAX_BRIEF_FILE_BYTES)
    expect(parseBriefMarkdown(saved).material).toBe(brief.value.material)
  })
})
