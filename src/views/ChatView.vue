<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import EmptyBrainState from '../components/EmptyBrainState.vue'
import LimitReachedDialog from '../components/LimitReachedDialog.vue'
import VoiceSphere from '../components/VoiceSphere.vue'
import VoiceSphereDialog from '../components/VoiceSphereDialog.vue'
import MessageList from '../components/MessageList.vue'
import TextComposer from '../components/TextComposer.vue'
import StopButton from '../components/StopButton.vue'
import ChatLiveRegion from '../components/ChatLiveRegion.vue'
import { useChat } from '../composables/useChat'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useWakeWord } from '../composables/useWakeWord'
import { useVoiceNarration } from '../composables/useVoiceNarration'
import { useSettings, isBodyUsable, hasOwnCloudKey } from '../composables/useSettings'
import { useCapabilities } from '../composables/useCapabilities'
import { useChatAnnouncer } from '../composables/useChatAnnouncer'
import { useSharedTurn } from '../composables/useSharedTurn'
import { useAuth } from '../composables/useAuth'
import type { Message } from '../types/message'

const { messages, sendMessage, cancelGeneration, openConversation, aiState, currentConversationId } = useChat()
const { settings } = useSettings()
const { sharedKey, ollama, refreshCapabilities } = useCapabilities()
const { user } = useAuth()
const { announce } = useChatAnnouncer()
const { loadLiveTokens } = useSharedTurn()

const route  = useRoute()
const router = useRouter()

// /c/:id があればその会話を開く。無ければensure/新規会話待ちの結果をcurrentConversationIdへ反映するだけで、
// URLへの反映はしない（下のwatch(currentConversationId, ...)に一本化し、二重ナビゲーションを避ける）
async function syncRouteConversation() {
  const routeId = typeof route.params.id === 'string' ? route.params.id : undefined
  await openConversation(routeId)
}

onMounted(syncRouteConversation)
watch(() => route.params.id, syncRouteConversation)

// 共有ページ（ROADMAP ③）から「同じ問いを自分のモデルで検算させる」で来た人の問い。
// 入力欄に入れるだけで送信はしない。無料枠を1回使う操作を、本人が押していないうちに
// 始めないため。読むのはマウント時の1回だけで、以降は普通の入力欄に戻る
const askFromShare = typeof route.query.ask === 'string' ? route.query.ask : ''

// 共有状態（どのターンを公開しているか）は自分のぶんだけを1回引く。
// MessageBubble の「この検算を共有する」がここを読む
onMounted(loadLiveTokens)

// 共有キーの残り回数はログイン状態で変わるため、マウント時と認証状態が変わるたびに取り直す
watch(() => user.value?.id, refreshCapabilities, { immediate: true })

// currentConversationIdが確定した瞬間（ページ読み込み時のensure、または「新規会話」からの
// 最初のメッセージ送信でconversationsに行が作られた瞬間）に、"/" のままだったURLを /c/<id> に反映する。
// URL同期はここ1箇所だけで行う
watch(currentConversationId, (id) => {
  if (id && route.path === '/') router.replace(`/c/${id}`)
})

const voiceActive = ref(false)

// AIが喋る側。逐次読み上げ（文が完成するたび）と、副体が考えている間の相槌を受け持つ。
// 読み上げが全部終わったら音声ラウンドの終了とみなす
const narration = useVoiceNarration(() => { voiceActive.value = false })

const voiceDialog = ref<InstanceType<typeof VoiceSphereDialog> | null>(null)
const appAside = ref<InstanceType<typeof AppAside> | null>(null)
const limitDialog = ref<InstanceType<typeof LimitReachedDialog> | null>(null)

// 履歴が空の状態から中央の球体で最初の発話をした場合、思考（thinking）が終わって
// 一体に収束するまではチャットログへ画面遷移させず、中央の球体画面のままにする
const firstExchangeInFlight = ref(false)

// 会話可能な体が1つ以上あるか。
// isBodyUsable は「provider===ollama なら常にtrue」を返すが、それは設定画面の見た目としては正しくても、
// このデプロイで実際にOllamaへ到達できるとは限らない（本番等）。ゲートの判定だけは
// capabilities.ollama.enabled で上書きし、送信して初めて接続エラーで失敗する偽陽性を防ぐ。
// 自分のクラウドキーが1つも無くても、共有キーの無料枠が残っていれば会話は成立するため、
// そちらも見ないと「使えるのに泣き顔」になってしまう（共有キーフォールバックの導入で発生した齟齬）
// 上限到達（個人枠 limit_reached / 全体枠 global_limit_reached）は「使えない」ではなく
// 「今日はもう使えない」なので、全画面差し替え（EmptyBrainState）の対象からは外す。
// not_signed_in / not_permitted / unavailable はそもそも使う手段が無い状態なので、
// 従来どおり全画面差し替えのまま
// 設定で共有キーをOFFにしている間は、枠が残っていても使わない（backend も同じ判定で
// ブロックごと飛ばす）。以降の判定は sharedKey.allowed ではなく必ずこちらを見る。
// 直接 sharedKey.allowed を見ると、OFF なのに「共有キーで利用中」と出たり、
// Ollama 未設定でも送信できるように見えたりして、UIとバックエンドの挙動がずれる
const sharedAllowed = computed(() => settings.useSharedKey && sharedKey.value.allowed)

const limitReached = computed(() =>
  settings.useSharedKey
  && (sharedKey.value.reason === 'limit_reached' || sharedKey.value.reason === 'global_limit_reached')
)

const hasActiveBody = computed(() =>
  settings.bodies.some(b => b.provider === 'ollama' ? ollama.value.enabled : isBodyUsable(b))
  || sharedAllowed.value
  || limitReached.value
)

// Ollamaを自分の手段として数えてよいか。
// isBodyUsable は provider==='ollama' を無条件trueにするため、このデプロイで実際に
// 到達できるかは capabilities.ollama.enabled でしか判定できない（hasActiveBody と同じ理由）
const ollamaUsable = computed(() =>
  ollama.value.enabled && settings.bodies.some(b => b.provider === 'ollama')
)

// 実際に送ってよいか（バックエンドが受け付けるかの事前チェック）。
// hasActiveBody と違い上限到達は含めない。ここがfalseのときに録音を始めると、
// 話し終えてから「上限到達」エラーで弾かれるだけなので、録音開始前にダイアログで止める。
// テキスト送信も同じ壁に当たるため、音声・文字の両方の入口でこれを見る。
//
// Ollamaを含めるのは、共有キーの枠が尽きても自前のローカルLLMがあれば会話は成立するため。
// hasOwnCloudKey は ollama を明示的に除外する（＝共有キーに乗ってよいかの判定）ので、
// ここに ollamaUsable を足さないと「Ollamaだけ設定したユーザー」が枠の有無に関わらず
// 一度も送信できない
const canSend = computed(() =>
  hasOwnCloudKey(settings.bodies) || ollamaUsable.value || sharedAllowed.value
)

// 自分のキーを設定せず共有キーに乗っている状態か（上限到達で allowed:false になった後も含む）。
// allowed だけで判定すると、上限到達の瞬間に「今どれだけ使ったか」が一番知りたいのに
// バッジごと消えてしまう。can_use_shared_key 自体は生きている上限到達はここに含める
const usingSharedKey = computed(() =>
  !hasOwnCloudKey(settings.bodies) && (sharedAllowed.value || limitReached.value)
)

// いまバックエンドが実際にローカルLLM（Ollama）で答える状態か。
// routes/chat.ts の分岐と同じ優先順位で判定する：自分のクラウドキーが最優先、
// 無ければ共有キー、それも使えなければ Ollama へ落ちる。
//
// 「共有キーが尽きた（limit_reached）」だけでなく unavailable / not_signed_in /
// not_permitted でも Ollama に落ちるため、条件は reason ではなく allowed の否定で見る
const usingLocalLLM = computed(() =>
  !hasOwnCloudKey(settings.bodies) && !sharedAllowed.value && ollamaUsable.value
)

// 生成中か（思考・統合・出力のいずれか）。停止ボタンの表示条件
const generating = computed(() => aiState.value !== 'idle')

const ttsLang = computed(() => settings.language === 'ja' ? 'ja-JP' : 'en-US')

// いま何体で考えるか。相槌の文言（「三人で考えています」）と、
// そもそも相槌を出すか（単体モードなら出さない）の判断に使う。
// 共有キー経路はユーザーの設定に関係なくバックエンドが必ず三体で走る（routes/chat.ts）
// Ollamaへ落ちている場合は共有キーの三体では走らないため、実際に動く体の数を数える。
// ここを 3 のままにすると「三人で考えています」と相槌を打った後に一体しか答えない
const activeBodyCount = computed(() => {
  if (usingSharedKey.value && !usingLocalLLM.value) return 3
  return settings.bodies.filter(b => b.provider === 'ollama' ? ollama.value.enabled : isBodyUsable(b)).length
})

// ユーザーが明示的に止めたときの後始末。
// 読み上げ（TTS）まで止めないと、止めたはずの応答が声だけ続いてしまう。
// voiceActive を先に落としてから中断するのは、中断で streaming が false になった瞬間に
// 下の watch が「完成した」と見なして途中までの応答を読み上げてしまうため
function handleStop() {
  voiceActive.value = false
  narration.stop()
  cancelGeneration()
  // 止めた結果は「何も起きなくなる」ことなので、音声だけで追っている人には
  // 明示的に伝えないと成功したのか分からない
  announce('生成を停止しました')
}

// 答えは残したまま、声だけ黙らせる。
//
// 生成そのものは止めない。読み上げだけが邪魔な場面（長いコードの解説を声で
// 聞かされている等）と、答えごと要らない場面（handleStop）は別の要求なので分ける。
// voiceActive を落とすことで、以降のストリーミング分も読み上げに回らなくなる
// （watch(responseText) と watch(streaming) がどちらも voiceActive を見ている）
function handleStopNarration(): void {
  narration.stop()
  voiceActive.value = false
  announce('読み上げを停止しました')
}

// 読み上げ中に球体へ触れたら、まず黙らせる。
//
// 止めた勢いで録音まで始めない。1タップで2つのことが起きると、
// 黙らせたかっただけの人がマイクを開かれる
function handleSphereTap(fallback: () => void): void {
  if (narration.speaking.value) {
    handleStopNarration()
    return
  }
  fallback()
}

// 読み上げだけが残っている区間か。
//
// StopButton は元々 generating の間しか出ていなかったが、TTS はキューを消化するため
// aiState が idle に戻った後も喋り続ける。長い回答だとその区間が20〜30秒あり、
// 「一番黙ってほしい瞬間に画面上の停止手段が何も無い」状態になっていた
// （球体タップは効くが、それを知る手がかりがどこにも出ていない）。
//
// generating を優先して二重には出さない。生成中は handleStop が読み上げごと止めるため、
// ボタンを2つ並べても選ぶ理由が無く、迷わせるだけになる
const narrating = computed(() => !generating.value && narration.speaking.value)

// 音声認識完了 → 確認を経て送信
const { recording, finalText, interimText, bars, errorMsg, start, stop } =
  useVoiceInput((text) => {
    voiceActive.value = true
    // 送信した瞬間から「AIが喋る側」の担当が始まる。
    // 三体モードは副体の並列ラウンドぶんだけ無音が空くので、ここから相槌を用意する
    narration.begin(activeBodyCount.value, ttsLang.value)
    sendMessage(text)
  })

// 録音を始めるすべての入口（中央の球体・下部の球体・ウェイクワード）はここを通す。
// canSend が false なら実際には録音せず、ダイアログで「使えない」ことを先に伝える
// （録音・発話を終えてからエラーで弾かれる体験を避ける）
function requestStart() {
  if (!canSend.value) { limitDialog.value?.open(); return }
  start()
}

function requestVoiceDialog() {
  if (!canSend.value) { limitDialog.value?.open(); return }
  voiceDialog.value?.open()
}

// テキスト入力からの送信。
// narration.begin() を呼ばないのが音声経路との唯一の違いで、これは意図的：
// 文字で打った人は画面を見ているので、答えを声で読み上げられると邪魔になる。
// 声で始めた会話は声で返し、文字で始めた会話は文字で返す
function handleTextSend(text: string) {
  if (!canSend.value) { limitDialog.value?.open(); return }
  sendMessage(text)
}

// 「アイリス」でウェイク → 録音開始。
// AIが喋っている最中は、ウェイクワードを言い直させずに話し始めただけで割り込ませる
const { listening: wakeListening, idle: wakeIdle, startListening, stopListening, resetIdle } = useWakeWord(
  () => { requestStart() },
  () => { handleBargeIn() },
)

// 人間の会話は割り込みで成立する。応答待ち〜読み上げの途中で話し始められたら、
// 言い終わるのを待たずに黙って聞く側に回る。生成そのものも止める
// （割り込まれた時点で、そのまま出てくる答えはもう用済みのため）。
// なお、割り込みを検知した時点の一言は認識器を開き直すあいだに落ちるので、
// 実際に送られるのは「割り込んだあとに話した内容」になる
function handleBargeIn() {
  narration.stop()
  voiceActive.value = false
  cancelGeneration()
  requestStart()
}

// ユーザーが一度でも明示的にマイクを使ったかどうか
const micEverUsed = ref(false)

// ウェイクワード待機を許してよいか。
//
// 待機中は SpeechRecognition を 350ms ごとに開き直し続ける（useWakeWord の onend）。
// Chrome ではその間ずっと音声が Google へ送られるため、「聞く理由が無い状態」では
// 必ず落とす。理由は今後増える想定なので、判定はこの1つの ref に集約しておく：
//   ① タブが見えているか（実装済み）
//   ② 一定時間なにも起きていないか（未実装。タブを表にしたまま離席した場合を拾う）
//   ③ ユーザーの手動トグル（未実装）
// 個別に startListening/stopListening を呼ぶ実装にすると、②③を足したときに
// 「トグルはオフなのに visibility で復帰する」といった competing な状態が生まれる
const pageVisible = ref(!document.hidden)
function handleVisibility() { pageVisible.value = !document.hidden }
onMounted(() => document.addEventListener('visibilitychange', handleVisibility))
onUnmounted(() => document.removeEventListener('visibilitychange', handleVisibility))

const wakeEnabled = computed(() => pageVisible.value && !wakeIdle.value)

// 初回画面の案内文。ウェイクワードの待機は micEverUsed が true になるまで始まらない
// （syncListening 参照）。マイクの許可がまだ無いためで、そこを飛ばして
// 「アイリスと呼んで」と案内すると、呼んでも何も起きない体験になる。
// 許可が取れた時点で「手を使わなくてよい」ことを初めて伝える
const startHint = computed(() => {
  // 時間切れで待機を降りた状態は必ず伝える。黙って止めると
  // 「アイリスと呼んでも反応しない」という壊れた見え方になる
  if (wakeIdle.value) return 'しばらく操作が無かったのでマイクを切りました。球体をタップで再開します'
  if (micEverUsed.value) return '「アイリス」と呼びかけるだけで話せます。文字でも送れます'
  return '球体をタップして話しかけてください（初回だけマイクの許可が要ります）'
})

watch(recording, (isRec) => {
  if (isRec) {
    micEverUsed.value = true
    // 球体をタップした＝また使う意思表示なので、時間切れで降りた待機を戻す
    resetIdle()
    if (messages.value.length === 0) firstExchangeInFlight.value = true
  }
})

// マイクは1つしかないので、いま誰が使うかを1箇所で決める。
// 分散させると「録音中なのにウェイクワード検知も回っている」類の競合が必ず生まれる
//   録音中          … useVoiceInput が占有する
//   音声ラウンド中  … バージイン待ち（何か話し始めたら割り込み）
//   それ以外        … ウェイクワード待機（一度マイクを使った後のみ）
//
// 「読み上げ中だけ」ではなく音声ラウンド全体で開けておく。読み上げは文ごとに
// 途切れるため、speaking に追従させると認識器の開閉が細かく繰り返される。
// また、応答を待っている無音の間にも割り込めたほうが会話として自然
function syncListening() {
  if (recording.value)   { stopListening(); return }
  // 聞いてよい状態でなければ、AIが喋っている最中（barge-in）でも開かない。
  // 見えていない画面のために音声を送り続ける理由が無い
  if (!wakeEnabled.value) { stopListening(); return }
  if (voiceActive.value) { startListening('barge-in'); return }
  if (micEverUsed.value) { startListening('wake'); return }
  stopListening()
}

watch([recording, voiceActive, micEverUsed, wakeEnabled], syncListening)

// 会話継続ダイアログは録音中・thinking 中（主体が答えを書き始めるまで）は開いたままにし、
// 本文の最初のトークンが届いた瞬間（thinking を抜けた瞬間）に自動で閉じて会話ログへ戻す。
// 検算カードは本文の後ろに流れてくるので、ここで移っておけば書き足されていく様子が見える。
//
// 統合方式の頃は副体が本文より先に走っていたため、pendingBodies の増加も併せて見ていた。
// 順序が反転して、副体が動くのは必ず本文が出たあと（＝ thinking を抜けたあと）になったので、
// この watch 一本で足りる
watch(aiState, (state, prevState) => {
  if (prevState === 'thinking' && state !== 'thinking') {
    voiceDialog.value?.close()
    firstExchangeInFlight.value = false
  }
})

// 録音中の音声認識結果を「あなた」の発言としてリアルタイムにメッセージ一覧へ表示
const draftMessage = computed<Message | null>(() => {
  if (!recording.value) return null
  return {
    id: 'draft',
    role: 'user',
    blocks: [{ type: 'text', content: finalText.value + interimText.value }],
    timestamp: new Date(),
    // 録音中にだけ出る下書きなので、経路は必ず音声
    modality: 'voice',
    streaming: true,
  }
})

// AI応答テキスト（TTS用）
const responseText = computed(() => {
  const last = messages.value.at(-1)
  if (last?.role !== 'assistant') return ''
  const block = last.blocks.find(b => b.type === 'text')
  return block?.type === 'text' ? block.content : ''
})

// 届いた本文を逐次読み上げへ。完成した文だけが読まれ、書きかけの文は次まで持ち越される。
// 応答が完成するまで一言も喋らなかった従来の挙動（外部レビュー #4）はここで解消している
watch(responseText, (text) => {
  if (voiceActive.value) narration.feed(text, ttsLang.value)
})

// ストリーミング完了 → 句点で終わらなかった最後の断片まで読み切る。
// 読み上げが尽きた時点で voiceActive が落ち（useVoiceNarration の onIdle）、
// ウェイクワード待機に戻る
watch(
  () => messages.value.at(-1)?.streaming,
  (streaming) => {
    if (voiceActive.value && streaming === false) narration.end(responseText.value, ttsLang.value)
  }
)

</script>

<template>
  <div class="flex flex-col h-dvh overflow-hidden">
    <!-- 画面のどのモード（球体だけ／会話ログ）でも読み上げが途切れないよう、最上位に置く -->
    <ChatLiveRegion />
    <AppHeader />

    <main class="flex-1 min-h-0 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950 ">
      <!-- いまどのキーで答えているか。共有キーの使用状況と、Ollamaへ落ちていることの表示を1つの帯にまとめる（上限到達後もここで「使い切った」ことが分かる） -->
      <div v-if="usingLocalLLM || usingSharedKey" 
        class="shrink-0 text-center text-xs py-1.5":class="usingLocalLLM
        ? 'text-emerald-700/90 bg-emerald-600/8 dark:text-emerald-300/80 dark:bg-emerald-400/10'
        : limitReached
        ? 'text-amber-600/90 bg-amber-500/10 dark:text-amber-300/90 dark:bg-amber-400/10'
        : 'text-indigo-600/80 bg-indigo-600/8 dark:text-indigo-300/80 dark:bg-indigo-500/10'"
      >
        <!-- Ollamaを最優先で判定する。共有キーが尽きた状態は usingSharedKey と usingLocalLLM が同時に真になるが、実際に答えるのはOllamaなので、「上限に達しました」だけを出すと答えが返ってくる事実と食い違う -->
        <template v-if="usingLocalLLM">
          ローカルLLMを使用中<template v-if="limitReached">（無料お試し枠は本日ぶん終了）</template>
        </template>
        <!-- 全体枠で止まっている場合、このユーザーの使用回数は0回のこともある。個人枠の「3/3回」を出すと事実と違う表示になるため文言ごと分ける -->
        <template v-else-if="sharedKey.reason === 'global_limit_reached'">
          本日ぶんの無料お試し枠（全体）が終了しました。明日また使えます。
        </template>
        <template v-else-if="sharedKey.reason === 'limit_reached'">
          共有キーの使用量が上限に達しました。（本日{{ sharedKey.dailyLimit }}/{{ sharedKey.dailyLimit }}回）
        </template>
        <template v-else>
          共有キーで利用中：本日あと{{ sharedKey.remaining }}/{{ sharedKey.dailyLimit }}回
        </template>
      </div>
      <!-- APIキー・モデル未設定：脳みそがまだない -->
      <div v-if="!hasActiveBody" class="flex-1 flex items-center justify-center">
        <EmptyBrainState :shared-key="sharedKey" @open-settings="appAside?.openSettings()" />
      </div>

      <!-- 設定済み・会話なし（最初の発話が思考中の場合も含む）：中央に大きな球体 -->
      <div v-else-if="messages.length === 0 || firstExchangeInFlight" class="flex-1 flex flex-col items-center justify-center px-6 gap-5 bg-gray-550">
        <div class="w-56 h-56 sm:w-72 sm:h-72">
          <VoiceSphere
            :recording="recording"
            :bars="bars"
            :wake-listening="wakeListening"
            @click="handleSphereTap(() => recording ? stop() : requestStart())"
          />
        </div>

        <!-- マイク拒否・非対応ブラウザ。出さないと「球体を押しても無反応」にしか見えない -->
        <p v-if="errorMsg" role="alert" class="text-sm text-center max-w-sm text-red-500 dark:text-red-400">
          {{ errorMsg }}
        </p>

        <!-- 最初の発話は収束するまでこの画面に留まるため、停止ボタンもここに要る -->
        <StopButton v-if="generating" @click="handleStop" />
        <StopButton v-else-if="narrating" mode="narration" @click="handleStopNarration" />


        <!-- 文字で始める入口。音声認識に対応しないブラウザ（Firefox等）ではここが唯一の入口になり、
             対応ブラウザでも「声に出したくない・出せない」場面の逃げ道になる -->
        <div class="w-full max-w-md space-y-1.5">
          <TextComposer :disabled="generating" :initial-text="askFromShare" @send="handleTextSend" />
          <p class="text-center text-[11px] text-gray-400 dark:text-white/25">
            {{ startHint }}
          </p>
        </div>
      </div>

      <!-- 会話中：メッセージ一覧 + 下部に小さな球体（タップで会話継続ダイアログ） -->
      <template v-else>
        <MessageList class="flex-1 min-h-0" :messages="messages" :draft-message="draftMessage" />
        <div class="shrink-0 flex flex-col items-center gap-2 px-4 py-3">
          <!-- 生成中だけ入力欄の上に出す。Lv5は最大32Kトークンあり、止める手段が無いと
               待たされ続けたうえ共有キーの枠も1回分消える -->
          <StopButton v-if="generating" @click="handleStop" />
          <!-- 生成が終わっても読み上げは続く。この区間は球体タップ以外に止める手段が
               無かったので、同じ位置にボタンを出して「触れば止まる」ことを学習させる -->
          <StopButton v-else-if="narrating" mode="narration" @click="handleStopNarration" />
          <div class="w-full max-w-2xl flex items-end gap-3">
            <div
              class="w-12 h-12 shrink-0 rounded-full overflow-hidden cursor-pointer transition-transform hover:scale-105"
              title="続けて話す"
              @click="handleSphereTap(() => requestVoiceDialog())"
            >
              <VoiceSphere
                :recording="recording"
                :bars="bars"
                :wake-listening="wakeListening"
                :show-status="false"
              />
            </div>
            <!-- 会話の途中でも声と文字を混ぜられるようにする（片方に決め打たない） -->
            <TextComposer class="flex-1 min-w-0" :disabled="generating" :initial-text="askFromShare" @send="handleTextSend" />
          </div>
        </div>
      </template>
    </main>

    <AppAside ref="appAside" />

    <VoiceSphereDialog
      ref="voiceDialog"
      :recording="recording"
      :bars="bars"
      :wake-listening="wakeListening"
      :error-msg="errorMsg"
      :generating="generating"
      :narrating="narrating"
      @toggle-mic="handleSphereTap(() => recording ? stop() : start())"
      @stop="handleStop"
      @stop-narration="handleStopNarration"
    />

    <LimitReachedDialog ref="limitDialog" :reason="sharedKey.reason" @open-settings="appAside?.openSettings()" />
  </div>
</template>
