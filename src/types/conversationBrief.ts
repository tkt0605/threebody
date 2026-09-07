export type BriefProgress = 'planned' | 'working' | 'done'
export interface ConversationBrief {
  purpose: string
  success: string
  decisions: string
  hypotheses: string
  questions: string
  nextStep: string
  // 読み込んだファイルの本文など、上の欄に当てはまらない資料。相談文にもそのまま載る
  material: string
  progress: BriefProgress
}

