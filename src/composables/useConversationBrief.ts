import { ref } from 'vue'
import type { ConversationBrief } from '../types/conversationBrief'
import { emptyBrief } from '../lib/conversationBrief'

// 同一タブ内でだけ共有する。認証情報や会話の長期記憶として保存しない。
const brief = ref<ConversationBrief>(emptyBrief())
const briefs = new Map<string, ConversationBrief>()
// /new で書きかけのノート。既存会話を見に行って戻っても残す。
// 最初の送信で会話IDが決まったら briefs へ移り、/new は空に戻る
let draft: ConversationBrief | null = null

// ダイアログの開閉。発火点（AppAside / AppHeader）と本体（ChatView）が階層上の兄弟なので
// useAsideDrawer と同じく module-level singleton で共有する
const noteOpen = ref(false)
export function openNote(): void { noteOpen.value = true }
export function closeNote(): void { noteOpen.value = false }

export function startConversationBrief(): void {
  brief.value = draft ?? emptyBrief()
  draft = brief.value
}

export function bindConversationBrief(id: string): void {
  briefs.set(id, brief.value)
  if (draft === brief.value) draft = null
}

export function openConversationBrief(id: string): void {
  brief.value = briefs.get(id) ?? emptyBrief()
  bindConversationBrief(id)
}

export function forgetConversationBrief(id: string): void {
  briefs.delete(id)
}

export function clearConversationBriefs(): void {
  briefs.clear()
  draft = null
  noteOpen.value = false
  startConversationBrief()
}

export function useConversationBrief() {
  return { brief, noteOpen }
}
