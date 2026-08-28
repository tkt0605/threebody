<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'
import MessageBubble from '../components/MessageBubble.vue'
import { useSharedTurn, type SharedTurn } from '../composables/useSharedTurn'
import type { Message } from '../types/message'

// 共有された1ターンの読み取り専用ページ（ROADMAP ③）。
//
// 【ここでLLMを呼ばない】表示するのは content_blocks に保存済みの text と perspective
// だけで、生成は一切走らない。何人が開いても無料枠が1回も減らないことが、この機能の
// 存在理由そのもの（ROADMAP 2章「律速は資金」を迂回する唯一の経路）。
//
// 【未ログインで開く】requiresAuth を付けない（router/index.ts）。ログインを挟んだ
// 時点で「見た人が自分の意思で他人に見せる」という前提が崩れる。

const route = useRoute()
const { fetchByToken } = useSharedTurn()

const turn    = ref<SharedTurn | null>(null)
const loading = ref(true)

// ここでは、関数の仮名で時間がかかる処理を裏側で実行するとのこと。
onMounted(async () => {
  const token = route.params.token
  turn.value  = typeof token === 'string' ? await fetchByToken(token) : null
  loading.value = false
})

// MessageBubble をそのまま使う。共有ページ用に別の描画を書くと、検算カードの見た目が
// アプリ内と食い違い、直したときに片方だけ古くなる。readonly で操作系だけを落とす

// 外部からの取得した共有データを既存の画面（チャットUI）に対応可能なMessageにリアルタイムで対応・表示
const answerMessage = computed<Message | null>(() => turn.value && {
  id:        turn.value.token,
  role:      'assistant',
  blocks:    turn.value.blocks,
  timestamp: turn.value.sharedAt,
  modality:  'text',
})

// 導線は「登録する」ではなく「同じ問いを自分のモデルで検算させる」（ROADMAP 2章）。
// 宛先は BYOK / Ollama 層で、この層は増えても運営のコストが増えない。
// 問いは ?ask= で運び、送信まではしない（本人が押していないうちに枠を使わない
//
// from= は共有リンク経由の再実行を計測するためのトークン（このページの route.params.token
// をそのまま横流しする。ChatView 側で読み、会話作成時に conversations.shared_from へ書く）
const askHref = computed(() => {
  if (!turn.value?.question) return '/new'
  const params = new URLSearchParams({ ask: turn.value.question })
  const token = route.params.token
  if (typeof token === 'string') params.set('from', token)
  return `/new?${params.toString()}`
})
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-200">
    <header class="border-b border-black/5 dark:border-white/10">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
        <ThreeBodyLogo class="w-5 h-5" />
        <span class="text-sm font-medium tracking-wide">ThreeBody</span>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 py-6">
      <p v-if="loading" class="text-sm text-gray-400 dark:text-white/35">読み込み中…</p>

      <!-- 取り消された共有と、存在しないURLを区別しない。区別すると「そのIDは実在する」
           ことだけが分かってしまう -->
      <div v-else-if="!turn" class="space-y-3">
        <p class="text-sm">このページは公開されていません。</p>
        <p class="text-xs text-gray-400 dark:text-white/35">
          共有が取り消されたか、URLが違います。
        </p>
      </div>

      <div v-else class="space-y-4">
        <!-- 問いが先。これが無いと、下の検算カードが何を指しているのか読めない -->
        <div v-if="turn.question" class="space-y-1">
          <span class="text-xs font-medium tracking-wide text-gray-400 dark:text-gray-500">問い</span>
          <p class="text-sm leading-relaxed border-b border-gray-200 dark:border-gray-600 pb-3">
            ❯ {{ turn.question }}
          </p>
        </div>

        <MessageBubble v-if="answerMessage" :message="answerMessage" readonly />

        <!-- 導線（ROADMAP 2章）。「登録する」とは書かない。頼まれた側に見せたくなる
             理由が無いのと同じで、登録そのものは相手の動機にならない -->
        <div class="pt-4 mt-2 border-t border-black/5 dark:border-white/10 space-y-2">
          <a
            :href="askHref"
            class="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl transition-colors
                   bg-gray-100 hover:bg-gray-200/70 text-gray-700
                   dark:bg-white/8 dark:hover:bg-white/12 dark:text-white/80"
          >同じ問いを自分のモデルで検算させる</a>
          <p class="text-xs leading-relaxed text-gray-400 dark:text-white/35">
            ThreeBody は、1つの答えを別のモデルに検算させます。自分のAPIキーか、
            手元の Ollama をそのまま使えます。
          </p>
        </div>
      </div>
    </main>
  </div>
</template>
