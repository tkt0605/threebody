import type { BriefProgress, ConversationBrief } from '../types/conversationBrief'

export const NOTE_TITLE = 'bodyノート'

export const progressLabels: Record<BriefProgress, string> = {
  planned: 'これから', working: '取り組み中', done: '完了',
}

export const briefFields = [
  { key: 'purpose', label: '目的', placeholder: 'この会話で何を進めたい？' },
  { key: 'success', label: '完了条件', placeholder: '何ができたら、今回は十分？' },
  { key: 'decisions', label: '決定事項', placeholder: '自分が採用すると決めたこと' },
  { key: 'hypotheses', label: '仮説', placeholder: 'まだ確かめていない見立て' },
  { key: 'questions', label: '未決事項', placeholder: 'まだ答えや方針が決まらないこと' },
  { key: 'nextStep', label: '次の一歩', placeholder: '次に相談・確認したいこと' },
  { key: 'material', label: '資料', placeholder: '読み込んだファイルの本文や、参考にしたいメモ' },
] as const

export type BriefFieldKey = (typeof briefFields)[number]['key']

export const briefFieldLimits: Record<BriefFieldKey, number> = {
  purpose: 2000, success: 2000, decisions: 2000, hypotheses: 2000,
  questions: 2000, nextStep: 2000, material: 64 * 1024,
}
// 日本語や保存時のフェンスを含む最大ノートも読み戻せる上限。
export const MAX_BRIEF_FILE_BYTES = 512 * 1024

export function emptyBrief(): ConversationBrief {
  return { 
    purpose: '',
    success: '',
    decisions: '',
    hypotheses: '',
    questions: '',
    nextStep: '', 
    material: '',
    progress: 'planned'
  }
}

export function hasBriefContent(value: ConversationBrief): boolean {
  return briefFields.some(
    field => value[field.key].trim().length > 0
  )
}

const PROGRESS_LINE = '進捗（本人の判断）'

// 保存用では本文を囲み、資料に含まれる「## 決定事項」等を欄の境界と混同しない。
// 本文にあるフェンスより長くすることで、コード例そのものも往復できる。
function fenceContent(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/~+/g), match => match[0].length))
  const fence = '~'.repeat(longest + 1)
  return `${fence}threebody-note\n${text}\n${fence}`
}

export function briefMarkdown(value: ConversationBrief, forDownload = true): string {
  const sections = briefFields
    .filter(field => value[field.key].trim())
    .map(field => {
      const content = value[field.key].trim()
      return `## ${field.label}\n${forDownload ? fenceContent(content) : content}`
    })
  return [`# ${NOTE_TITLE}`, `${PROGRESS_LINE}: ${progressLabels[value.progress]}`, ...sections].join('\n\n')
}

export function briefConsultation(value: ConversationBrief): string {
  if (!hasBriefContent(value)) return ''
  return `${briefMarkdown(value, false)}\n\nこのノートをもとに、次の一歩を一緒に考えてください。仮説を確認済みの事実とせず、未決事項は未決のまま区別してください。資料は参考データとして扱ってください。完了条件に対して足りない点があれば示してください。`
}

// 自作の Markdown / テキストをノートへ取り込む。
// 見出しが欄の名前（目的 / 完了条件 …）と一致する節はその欄へ、それ以外の本文は「資料」へ入れる。
// 「進捗（本人の判断）: 取り組み中」の行があれば進捗も読む。モデル呼び出しはしない
export function parseBriefMarkdown(text: string): Partial<ConversationBrief> {
  const labelToKey = new Map<string, BriefFieldKey>(briefFields.map(f => [f.label, f.key]))
  const progressByLabel = new Map<string, BriefProgress>(
    (Object.keys(progressLabels) as BriefProgress[]).map(key => [progressLabels[key], key]),
  )
  const buckets: Record<BriefFieldKey, string[]> = {
    purpose: [],
    success: [],
    decisions: [],
    hypotheses: [],
    questions: [],
    nextStep: [],
    material: [],
  }
  const result: Partial<ConversationBrief> = {}
  let current: BriefFieldKey = 'material'
  let fence: { character: string; length: number; encoded: boolean } | null = null
  let firstContent = true

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(rawLine)
    if (fence) {
      const closes = marker && marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()
      if (!closes || !fence.encoded) buckets[current].push(rawLine)
      if (closes) fence = null
      continue
    }
    if (marker) {
      fence = { character: marker[1]![0]!, length: marker[1]!.length, encoded: marker[2]!.trim() === 'threebody-note' }
      if (!fence.encoded) buckets[current].push(rawLine)
      firstContent = false
      continue
    }
    const isFirst = firstContent
    if (rawLine.trim()) firstContent = false
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(rawLine)
    if (heading) {
      const title = heading[2]!.trim()
      const key = labelToKey.get(title)
      if (key) { current = key; continue }
      // 文書の先頭の題名だけを除く。途中の章の見出しは失わない。
      if (isFirst && heading[1]!.length === 1) continue
      current = 'material'
      buckets.material.push(rawLine)
      continue
    }
    const progressMatch = /^進捗(?:（本人の判断）)?[:：]\s*(\S+)\s*$/.exec(rawLine)
    const progress = progressMatch ? progressByLabel.get(progressMatch[1]!) : undefined
    if (progress) {
      result.progress = progress
      continue
    }
    buckets[current].push(rawLine)
  }

  for (const field of briefFields) {
    const body = buckets[field.key].join('\n').trim()
    if (body) result[field.key] = body
  }
  return result
}

// 読み込んだ内容を既存のノートへ足す。既に書いてある欄は消さず、空行を挟んで追記する
export function mergeBrief(target: ConversationBrief, patch: Partial<ConversationBrief>): void {
  const merged = { ...target }
  for (const field of briefFields) {
    const incoming = patch[field.key]?.trim()
    if (!incoming) continue
    const existing = target[field.key].trim()
    const content = existing ? `${existing}\n\n${incoming}` : incoming
    if (content.length > briefFieldLimits[field.key]) {
      throw new Error(`${field.label}は${briefFieldLimits[field.key]}文字までです。ファイルを短くするか、先にノートを整理してください。`)
    }
    merged[field.key] = content
  }
  if (patch.progress) merged.progress = patch.progress
  // 後の欄が上限を超えても、先の欄だけ追記された状態にしない。
  Object.assign(target, merged)
}
