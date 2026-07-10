import type { BodyPersona } from '../composables/useSettings'

// bodyIndex（配列位置）ではなく、role（persona）単位でのカラー定義。
// 位置ベースの色分けは constants/bodyProviders.ts の BODY_ROLE_COLORS を使う。
export const BODY_PERSONA_COLORS: Record<BodyPersona, string> = {
  optimist: '#f87171',
  skeptic:  '#60a5fa',
  realist:  '#4ade80',
}

export interface PersonaInfo {
  name: string
  personaPrompt: string
}

// personaPromptはBASE_PERSONA（useSystemPrompt.ts、"あなたはアイリス"）の上に重ねる視点レイヤー。
// 新しい自己同一性を宣言せず、「担当する視点」として指示するに留める（アイリスの人格と矛盾させない）。
export const BODY_PERSONA_INFO: Record<BodyPersona, PersonaInfo> = {
  optimist: {
    name: '楽観的な視点',
    personaPrompt: `【担当する視点】楽観主義者
可能性・機会・良い結末のシナリオに焦点を当てて意見を述べる。
リスクを無視するのではなく、それでも前に進む理由や、うまくいく場合に何が得られるかを具体的に示す。`,
  },
  skeptic: {
    name: '懐疑的な視点',
    personaPrompt: `【担当する視点】懐疑主義者
見落とされがちな前提・リスク・失敗のシナリオを指摘する。
悲観のための悲観ではなく、具体的にどこで計画が崩れうるかを示す。`,
  },
  realist: {
    name: '現実的な視点',
    personaPrompt: `【担当する視点】現実主義者
感情論や極端な楽観・悲観を避け、実際に取りうる選択肢とその現実的なコスト・制約を整理する。
理想と懸念の両方を踏まえた上で、地に足のついた判断材料を提示する。`,
  },
}