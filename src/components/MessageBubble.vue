<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFeedback } from '../composables/useFeedback'
import type { BodyPerspective, ErrorBlock, TextBlock } from '../types/message'
import { marked } from 'marked'
import { highlightCode, highlighterReady } from '../lib/highlighter'
import type { Message } from '../types/message'
import DOMPurify from 'dompurify'
import { BODY_ROLE_COLORS } from '../constants/bodyProviders'
import { useChat } from '../composables/useChat'
import { useSharedTurn, shareUrl } from '../composables/useSharedTurn'
import type { OrphanReason } from '../lib/orphanReason'
import { log } from 'node:console'
// orphanReason は「答えが付いていない理由」。判定は MessageList が持つ
// （0ブロックの応答は描画対象から外れており、その行が理由を持っているため）
// questionMessageId は直前のユーザー発言。共有ページに問いを載せるために要る
// （どのメッセージが直前かを知っているのは MessageList だけ）
const props = defineProps<{
  message: Message
  orphanReason?: OrphanReason
  readonly?: boolean
  questionMessageId?: string | null
}>()

const emit = defineEmits<{ voice_dialog_run: [], edit_request: [text: string] }>()

const { editOrphanedTurn, deleteOrphanedTurn } = useChat()

// 孤立ターンの説明文。原因を断定しないこと。自分で止めた場合を「エラーで途切れた」と書くと、
// 起きていない障害を報告することになる。断定できるのは stopped 系だけで、
// それ以外（lost）は「届かなかった」という観測事実に留める
const orphanCopy = computed(() => {
  switch (props.orphanReason) {
    case 'stopped-partial': return '途中で止まりました。ここまでの内容は残っています。'
    case 'stopped-empty':   return '答えが出る前に停止しました。'
    case 'lost':            return '応答が届きませんでした。'
    default:                return ''
  }
})

// 質問を送り直す導線は、送られたモダリティに合わせる。声で聞かれた質問を
// 文字入力へ強制すると、声を主役にしてきたこのアプリの体験と断絶するため
const isVoiceOrphan = computed(() => props.message.modality === 'voice')

// 中断された質問メッセージと、対になる中断応答は先に削除しておく。
// そうしないと編集して送った／話し直した新しい質問が古い中断ペアと並んで残る
const isEditing = ref(false);
async function handleEdit(): Promise<void> {
  if(isEditing.value) return
  isEditing.value = true
  try {
    // 削除する前にテキストの内容を取得し
    const text = props.message.blocks
      .filter((b): b is TextBlock => b.type === "text")
      .map(b => b.content)
      .join("")
    console.log("テキスト内容の取得:", text)
    emit('edit_request', text)
    await editOrphanedTurn(props.message)
  } catch (error) {
    console.log('テキスト編集機能・呼び出し失敗:', error)
  }finally{
    isEditing.value = false
  }
}

const isRecording = ref(false);
async function handleRedoVoice(): Promise<void> {
  if(isRecording.value) return
  isRecording.value = true
  try {
    // Voice用のダイヤログを呼び出し
    emit('voice_dialog_run')
    // deleteを呼び出している。ここは削除。
    await deleteOrphanedTurn(props.message)
    console.log("再投稿・音声認識ダイヤログ・呼び出し成功")
    // 呼び出しのemitまでは成功
  } catch (error) {
    console.log('音声取り直し失敗:', error)
  }finally{
    isRecording.value = false
  }
}

// ── 共有（ROADMAP ③） ────────────────────────────────────────────────────────
const { share, revoke, tokenFor, pending } = useSharedTurn()
const copied = ref(false)

const shareToken = computed(() => tokenFor(props.message.id))

// 共有ボタンを出すのは検算カードが付いたターンだけ。
// 統合された1つの答えは他のチャットAIのスクリーンショットと区別がつかず、
// 見せたくなる理由が立たない（ROADMAP 0章）。答えと指摘が並んでいる状態だけが資産
const reviewed = computed(() =>
  props.message.role === 'assistant'
  && !props.message.streaming
  && props.message.blocks.some(b => b.type === 'perspective' && b.bodies.some(x => x.done))
)

async function copyShareUrl(token: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl(token))
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // クリップボードAPIが使えない環境では、下に出ているURLを手で選んでもらう
  }
}

async function onShare(): Promise<void> {
  const token = shareToken.value ?? await share(props.message.id, props.questionMessageId ?? null)
  if (token) await copyShareUrl(token)
}
const { reportError } = useFeedback()
type ReportState = 'idle' | 'sending' | 'done' | 'failed'
const reportStates = ref<Record<number, ReportState>>({})

async function report(block: ErrorBlock, i: number): Promise<void>{
  const state = reportStates.value[i]
  if (!block.context || state === 'sending' || state === "done")return
  reportStates.value[i] = 'sending'
  try {
    await reportError(block.context)
    reportStates.value[i] = 'done'
  } catch (error) {
    console.error('報告の送信失敗：', error);
    reportStates.value[i] = 'failed'
  }
}
function roleColor(bodyIndex: number): string {
  return BODY_ROLE_COLORS[bodyIndex] ?? '#8b8b8b'
}

// 「指摘なし」で確定した体、および中身が空のまま確定した体を畳む。
// done === false（判定未確定・ストリーミング中の一時的な空文字を含む）と
// hasFinding === undefined（旧データ・旧バックエンド）は「不明」として残すが、
// 空文字だけは別。toContentBlock（lib/contentBlocks.ts）がリロード時に done を
// 強制的に true へ立て直すため、中断されたターンの「まだ何も書いていない体」が
// 「確定済みだが空」というノイズになって出てくる
function visibleBodies(bodies: BodyPerspective[]): BodyPerspective[] {
  return bodies.filter(b => !(b.done === true && (b.hasFinding === false || !b.content.trim())))
}

marked.setOptions({ breaks: true })

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const language = (lang ?? '').trim().split(/\s+/)[0] ?? ''
  const source = text.replace(/\n$/, '')
  // 未対応言語・shiki初期化未完了時は null。その場合は従来どおりのプレーン表示に倒す
  const body = highlightCode(source, language)
    ?? `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(source)}\n</code></pre>`
  return `<div class="code-block">
<div class="code-block-header">
<span class="code-block-lang">${escapeHtml(language)}</span>
<button type="button" class="copy-btn">
<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
  <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>
</svg>
<svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
  <path d="M13.485 1.929a.75.75 0 0 1 .07 1.058l-7.25 8.25a.75.75 0 0 1-1.114.045l-3.25-3.5a.75.75 0 1 1 1.098-1.022l2.668 2.872 6.722-7.65a.75.75 0 0 1 1.058-.07z"/>
</svg>
</button>
</div>
${body}
</div>`
}
marked.use({ renderer })

function renderMarkdown(content: string): string {
  // highlighterReady を読むことでリアクティブ依存として登録する。shikiの初期化が
  // 完了した瞬間にこのref経由でテンプレートが再描画され、プレーン表示から
  // ハイライト済み表示へ切り替わる（renderMarkdown自体はメモ化されていないため、
  // 値を使わなくても参照するだけで依存が張られる）
  void highlighterReady.value

  // async: false を明示して同期版のオーバーロードを選ぶ。省略すると戻り値の型が
  // string | Promise<string> になり、String() でくるむと Promise のときに
  // 「[object Promise]」がそのまま描画されうる
  return marked.parse(content, { async: false })
}

function handleCopyClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('.copy-btn')
  if (!button) return

  const code = button.closest('.code-block')?.querySelector('code')
  if (!code) return

  navigator.clipboard.writeText(code.textContent ?? '').then(() => {
    button.classList.add('copied')
    button.disabled = true
    setTimeout(() => {
      button.classList.remove('copied')
      button.disabled = false
    }, 1500)
  }).catch(() => {
    // クリップボードAPIが使えない環境では何もしない
  })
}
</script>

<template>
  <div class="flex flex-col w-full">
    <span
      class="px-3 pt-3 pb-0.5 text-xs font-medium tracking-wide"
      :class="message.role === 'user'
        ? 'text-gray-400 dark:text-gray-500'
        : 'text-indigo-400'"
    >
      {{ message.role === 'user' ? 'あなた' : 'I.R.I.S' }}
    </span>
    <div
      class="max-w-[100%] px-3 py-3 text-sm leading-relaxed"
      :class="
        message.role === 'user'
          ? 'w-full border-b border-gray-600 dark:text-white text-gray-900'
          : 'backdrop-blur-sm dark:text-gray-300 text-gray-800'
      "
    >
      <template v-for="(block, i) in message.blocks" :key="i">
        <span class="block" v-if="block.type === 'text' && (block.content || message.streaming) && message.role === 'user'">
          ❯ {{ block.content }}<span v-if="message.streaming" class="animate-pulse" aria-hidden="true">▍</span>
        </span>
        <div
          v-else-if="block.type === 'text' && (block.content || message.streaming) && message.role === 'assistant'"
          class="prose-content"
          :class="block.bodyIndex != null ? 'border-l-2 pl-3 -ml-3' : ''"
          :style="block.bodyIndex != null ? { borderColor: roleColor(block.bodyIndex) } : {}"
          v-html="DOMPurify.sanitize(renderMarkdown(block.content)) + (message.streaming ? '<span class=\'animate-pulse\' aria-hidden=\'true\'>▍</span>' : '')"
          @click="handleCopyClick"
        />
        <!-- 検算カードは本文の下に並ぶ。仕切りを上に置くのは、カードが「この答えを読んだ結果」
             であることを、読む順序そのもので示すため -->
        <div v-else-if="block.type === 'perspective' && visibleBodies(block.bodies).length > 0" class="space-y-2 mt-4">
          <div class="flex items-center gap-2 text-[10px] tracking-wide text-gray-400 dark:text-white/30">
            <span class="flex-1 border-t border-dashed border-black/10 dark:border-white/10" />
            他の体がこの答えを検算
            <span class="flex-1 border-t border-dashed border-black/10 dark:border-white/10" />
          </div>
          <!-- ここは二・三体の答えの出力フィールド -->
          <div class="grid gap-2" :class="visibleBodies(block.bodies).length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
            <div
              v-for="b in visibleBodies(block.bodies)"
              :key="b.bodyIndex"
              class="rounded-xl border px-3 py-2.5 text-xs leading-relaxed bg-black/[0.02] dark:bg-white/[0.03]"
              :style="{ borderColor: roleColor(b.bodyIndex) + '40' }"
            >
              <div class="flex items-center gap-1.5 mb-1.5 font-medium" :style="{ color: roleColor(b.bodyIndex) }">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: roleColor(b.bodyIndex) }" />
                {{ b.name }}
              </div>
              <div
                class="prose-content text-gray-600 dark:text-white/60"
                v-html="DOMPurify.sanitize(renderMarkdown(b.content)) + (!b.done ? '<span class=\'animate-pulse\' aria-hidden=\'true\'>▍</span>' : '')"
                @click="handleCopyClick"
              />
            </div>
          </div>
        </div>
        <div
          v-else-if="block.type === 'error'"
          class="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs bg-red-500/10 border border-red-500/30 text-red-300 mt-1"
        >
          <svg class="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="flex-1 space-y-1.5">
            <span class="block">{{ block.message }}</span>
            <!-- エラー時の報告はワンクリックで完結させる。入力欄は出さない（この時点のユーザーは既に躓いている） -->
            <button
              v-if="block.context && !readonly"
              class="text-[11px] underline underline-offset-2 transition-opacity cursor-pointer
                     disabled:cursor-default disabled:no-underline disabled:opacity-60"
              :disabled="reportStates[i] === 'sending' || reportStates[i] === 'done'"
              @click="report(block, i)"
            >{{
              reportStates[i] === 'done'      ? '報告しました。ありがとうございます'
              : reportStates[i] === 'sending' ? '送信中…'
              : reportStates[i] === 'failed'  ? '送信できませんでした。もう一度試す'
              : 'この問題を報告する'
            }}</button>
          </div>
        </div>
      </template>
      <!-- 共有（ROADMAP ③）。既定は非公開で、押したターンだけが公開される。
           閲覧側はLLMを呼ばないので、何人見ても無料枠は1回も減らない -->
      <div v-if="reviewed && !readonly" class="pt-2">
        <div v-if="shareToken" class="space-y-1.5">
          <div class="flex items-center gap-2">
            <code class="flex-1 truncate text-[11px] px-2 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] text-gray-500 dark:text-white/50">{{ shareUrl(shareToken) }}</code>
            <button
              class="text-[11px] px-2 py-1 rounded-md transition-colors cursor-pointer
                     bg-gray-100 hover:bg-gray-200/70 text-gray-600
                     dark:bg-white/6 dark:hover:bg-white/10 dark:text-white/60"
              @click="copyShareUrl(shareToken)"
            >{{ copied ? 'コピーしました' : 'コピー' }}</button>
          </div>
          <button
            class="text-[11px] underline underline-offset-2 text-gray-400 dark:text-white/35 cursor-pointer
                   disabled:cursor-default disabled:no-underline"
            :disabled="pending === message.id"
            @click="revoke(message.id)"
          >公開をやめる</button>
        </div>
        <button
          v-else
          class="text-[11px] underline underline-offset-2 text-gray-400 dark:text-white/35 cursor-pointer
                 disabled:cursor-default disabled:no-underline"
          :disabled="pending === message.id"
          @click="onShare"
        >{{ pending === message.id ? 'リンクを作成中…' : 'この検算を共有する' }}</button>
      </div>
      <!-- 答えが付いていない理由を先に書く。ボタン2つだけだと「なぜ送り直す必要が
           あるのか」が分からず、押してよいのかも判断できない。
           送られたモダリティに合わせて、声の質問には話し直す（音声）を、
           文字の質問には編集して送る（TextComposerへ注入）を出し分ける -->
      <div v-if="orphanReason && !readonly" class="pt-1 space-y-1.5">
        <p class="text-xs leading-relaxed text-gray-400 dark:text-white/35">
          {{ orphanCopy }}
        </p>
        <div class="flex gap-2">
          <!-- 修正すべき点はここのhandleRedoVoiceとhandleEdit -->
          <button
            v-if="isVoiceOrphan"
            class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer
                   bg-gray-100 hover:bg-gray-200/70 text-gray-600
                   dark:bg-white/6 dark:hover:bg-white/10 dark:text-white/60"
            @click="handleRedoVoice"
          >話し直す</button>
          <button
            v-else
            class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer
                   bg-gray-100 hover:bg-gray-200/70 text-gray-600
                   dark:bg-white/6 dark:hover:bg-white/10 dark:text-white/60"
            @click="handleEdit"
          >編集して送る</button>
          <!-- ここの削除の処理は良い。 -->
          <button
            class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer
                   bg-red-500/10 hover:bg-red-500/15 text-red-400"
            @click="deleteOrphanedTurn(message)"
          >削除する</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prose-content :deep(p) {
  margin-bottom: 0.5em;
}
.prose-content :deep(p:last-child) {
  margin-bottom: 0;
}
.prose-content :deep(h1),
.prose-content :deep(h2),
.prose-content :deep(h3),
.prose-content :deep(h4) {
  font-weight: 600;
  margin-top: 0.75em;
  margin-bottom: 0.25em;
}
.prose-content :deep(h1) { font-size: 1.2em; }
.prose-content :deep(h2) { font-size: 1.1em; }
.prose-content :deep(h3) { font-size: 1em; }
.prose-content :deep(ul),
.prose-content :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: 0.5em;
}
.prose-content :deep(li) {
  margin-bottom: 0.15em;
}
/* コードブロックの配色。
   ライト = 薄いグレー（ダークのスレート #262a33 と同じ寒色系に揃え、テーマ切替時の
   印象差を小さくする）／ダーク = 従来の値をそのまま維持。
   v-html で描画される中身にはスコープ属性が付かないため個別に色を指定できないが、
   カスタムプロパティは .prose-content から継承されるので、変数だけ切り替えれば全体に効く */
.prose-content {
  /* コード背景はページ地色（bg-gray-50 #f9fafb、ChatView.vue）とのコントラストを
     意図的に離す。図地分離（Gestalt）はヘッダーバー・枠だけでなく背景の明度差が
     効いて初めて「浮いて見える」。旧値 #f4f5f7 はページ地色とほぼ同明度（コントラスト比約1.03）
     で、枠線だけに分離を頼っていた */
  --code-bg:          #dde0e5;
  --code-fg:          #32363d;
  --code-border:      #c3c8d0;
  --code-header-bg:   #cdd1d8;
  --code-header-fg:   #4e5561;
  --code-lang-alpha:  0.9;
  --code-inline-bg:   rgba(110, 120, 140, 0.14);
  --code-btn-border:  rgba(100, 110, 125, 0.35);
  --code-btn-hover:   rgba(100, 110, 125, 0.13);
  --code-ok:          #16a34a;
  --code-ok-border:   rgba(22, 163, 74, 0.45);

  /* shiki（renderer.code、lib/highlighter.ts）が css-variables テーマ経由で参照するトークン色。
     --shiki-background は透明にして .code-block pre 側の background:none をそのまま効かせる */
  --shiki-foreground:              var(--code-fg);
  --shiki-background:              transparent;
  --shiki-token-keyword:           #7c3aed;
  --shiki-token-string:            #15803d;
  --shiki-token-string-expression: #0f766e;
  --shiki-token-comment:           #6e7781;
  --shiki-token-constant:          #b45309;
  --shiki-token-function:          #1d4ed8;
  --shiki-token-parameter:         #3f3f46;
  --shiki-token-punctuation:       #57606a;
  --shiki-token-link:              #0969da;
}
.dark .prose-content {
  --code-bg:          #262a33;
  --code-fg:          #e2e4e9;
  --code-border:      rgba(255, 255, 255, 0.08);
  --code-header-bg:   #2f3440;
  --code-header-fg:   rgba(255, 255, 255, 0.5);
  --code-lang-alpha:  0.6;
  --code-inline-bg:   rgba(128, 128, 128, 0.15);
  --code-btn-border:  rgba(128, 128, 128, 0.3);
  --code-btn-hover:   rgba(128, 128, 128, 0.15);
  --code-ok:          #4ade80;
  --code-ok-border:   rgba(74, 222, 128, 0.4);

  --shiki-foreground:              var(--code-fg);
  --shiki-background:              transparent;
  --shiki-token-keyword:           #c792ea;
  --shiki-token-string:            #9ece6a;
  --shiki-token-string-expression: #7dcfff;
  --shiki-token-comment:           #6b7280;
  --shiki-token-constant:          #ff9e64;
  --shiki-token-function:          #7aa2f7;
  --shiki-token-parameter:         #c8ccd4;
  --shiki-token-punctuation:       #9aa5ce;
  --shiki-token-link:              #7aa2f7;
}

.prose-content :deep(code) {
  font-family: ui-monospace, monospace;
  background: var(--code-inline-bg);
  padding: 0.1em 0.3em;
  border-radius: 0.25em;
  font-size: 0.85em;
}
/* フェンス付きコードは .code-block 経由で描画されるため、ここは字下げコード等の保険 */
.prose-content :deep(pre) {
  background: var(--code-bg);
  color: var(--code-fg);
  border: 1px solid var(--code-border);
  padding: 0.75em 1em;
  border-radius: 0.5em;
  overflow-x: auto;
  margin-bottom: 0.5em;
}
.prose-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.9em;
}
.prose-content :deep(.code-block) {
  margin-bottom: 0.5em;
  border-radius: 0.5em;
  overflow: hidden;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  color: var(--code-fg);
}
.prose-content :deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25em 0.75em;
  font-size: 0.75em;
  background: var(--code-header-bg);
  border-bottom: 1px solid var(--code-border);
  color: var(--code-header-fg);
}
.prose-content :deep(.code-block-lang) {
  font-family: ui-monospace, monospace;
  /* ライトは背景とのコントラストが取りにくいので、ダークより薄めない */
  opacity: var(--code-lang-alpha);
  text-transform: lowercase;
}
.prose-content :deep(.copy-btn) {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  font-size: 0.75em;
  padding: 0.15em 0.6em;
  border-radius: 0.35em;
  border: 1px solid var(--code-btn-border);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.prose-content :deep(.copy-btn:hover) {
  background: var(--code-btn-hover);
}
.prose-content :deep(.copy-btn:disabled) {
  opacity: 0.6;
  cursor: default;
}
.prose-content :deep(.check-icon) {
  display: none;
  color: var(--code-ok);
}
.prose-content :deep(.copy-btn.copied) {
  border-color: var(--code-ok-border);
}
.prose-content :deep(.copy-btn.copied .copy-icon) {
  display: none;
}
.prose-content :deep(.copy-btn.copied .check-icon) {
  display: inline;
}
/* .code-block が枠と背景を持つので、内側の pre は素通しにする
   （上の汎用 pre ルールの border/background をここで打ち消す） */
.prose-content :deep(.code-block pre) {
  margin-bottom: 0;
  border-radius: 0;
  background: none;
  border: none;
}
.prose-content :deep(strong) {
  font-weight: 600;
}
.prose-content :deep(em) {
  font-style: italic;
}
.prose-content :deep(blockquote) {
  border-left: 2px solid rgba(128, 128, 128, 0.35);
  padding-left: 0.75em;
  opacity: 0.75;
  margin-bottom: 0.5em;
}
.prose-content :deep(a) {
  text-decoration: underline;
  opacity: 0.8;
}
.prose-content :deep(hr) {
  border: none;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  margin: 0.75em 0;
}
</style>
