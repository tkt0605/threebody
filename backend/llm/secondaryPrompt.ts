import type OpenAI from 'openai'
import type { SecondaryRole } from './types'
import { extractTextContent } from './messageHelpers'
import { CORE_PRINCIPLES } from './promptLayers'
// 副体（二体・三体）に渡すもの一式。system・user・表示名をここ1箇所で組む。
//
// 【なぜ backend に寄せたか】
// 以前は副体の system をフロント（constants/bodyPersonas.ts + useSystemPrompt.ts）で
// 組んで personaPrompt として送っていたが、共有キー経路だけは chat.ts が別の文面を
// 組んでいた。同じ役割の指示が2箇所にあると片方だけ古くなる（実測: 「コードを書くな」が
// 共有キー経路にだけ届いていなかった）。フロントは role を送るだけにして、文面はここに
// 一本化する。古いバンドルが personaPrompt を送ってきても backend は見ない。
//
// 【なぜ会話人格（アイリス）を渡さないか】
// 副体の出力はユーザー宛の発言ではなく、主体だけが読む検討メモ。会話人格には
// 「相手の言葉を受ける → 見解を一言 → 問い返す」「相槌は『なるほど』」が入っており、
// 副体に渡すと指示どおり「なるほど」で受けて普通に回答する。視点レイヤーを末尾に
// 3行足しても、長い会話人格のほうが強い。人格ごと外すのが正しい。

// 【検算モード（本番経路）と 検討メモモード（実験専用）】
// 本番の副体は buildReview* を使う。主体が先に答え、その答えを副体が検算する。
// 下の ROLE_SLOTS / buildSecondary* は「主体が答える前に検討メモを書く」旧・統合方式の
// もので、本番経路からは外れている。消していないのは scripts/experiment-synthesis.ts が
// 統合方式との比較（腕B・腕C）にこれを使うため。別モデル・別プロバイダーで
// 統合方式を測り直す手段を失うと、統合をやめた判断そのものを検証できなくなる。
// 本番の挙動を変えるときは、必ず buildReview* 側を触ること。

// 3つの役はそれぞれ「別の問いに答える」。態度（楽観/懐疑/現実）の違いだけでは、
// 同じモデル・同じ入力に対して同じ答えが返る。答える対象そのものを分けると、
// 中身が重なりようがなくなる。
//
// スロット名 = カードの見出し。ユーザーには「3体が同じ問いで割れている」ことが
// 見出しの時点で分かる（docs/ROADMAP.md ③の資産）
const ROLE_SLOTS: Record<SecondaryRole, { label: string; task: string; slots: string }> = {
  skeptic: {
    label: '崩れる点',
    task: 'この問いの答えが最も失敗しやすい箇所を1つだけ挙げる',
    slots: `崩れる点: （最も失敗しやすい箇所を1つ、40字以内）
理由: （なぜそこが崩れるか。2〜3行）
確度: （高／中／低。確認していない前提があれば「未確認: ○○」と続ける）`,
  },
  optimist: {
    label: '別の見方',
    task: '多くの人が最初に選ぶ標準解とは違う筋を1つだけ挙げる',
    slots: `別の見方: （標準解とは違う筋を1つ、40字以内）
効く条件: （その筋が標準解に勝つのはどんな状況か。2〜3行）
確度: （高／中／低。確認していない前提があれば「未確認: ○○」と続ける）`,
  },
  realist: {
    label: '最初の一手',
    task: '今日から着手できる具体的な1手と、そこで最初に詰まる箇所を挙げる',
    slots: `最初の一手: （今日から着手できる1手を、40字以内）
詰まる所: （その一手を進めたとき最初に詰まる箇所。2〜3行）
確度: （高／中／低。確認していない前提があれば「未確認: ○○」と続ける）`,
  },
}

export function secondaryRoleLabel(role: SecondaryRole): string {
  return ROLE_SLOTS[role].label
}

// role が届かない場合（古いフロント・curl）の割り当て。既定の設定では
// 副体は skeptic → realist の順に並ぶので、その並びをそのまま既定にする
const FALLBACK_ORDER: SecondaryRole[] = ['skeptic', 'realist', 'optimist']

export function resolveSecondaryRole(role: string | undefined, indexAmongSecondaries: number): SecondaryRole {
  if (role === 'skeptic' || role === 'optimist' || role === 'realist') return role
  return FALLBACK_ORDER[indexAmongSecondaries % FALLBACK_ORDER.length]!
}

// 言語の指示は system に自前で持つ。会話人格には「日本語で話す」が含まれていたが、
// 副体からその人格ごと外したため、指示が無いと小さいモデルは英語や他言語へ流れる
// （実測: llama3:8b が「最初の一手」の本文だけ英語で返した）。
// 設定の language ではなく「問いと同じ言語」に紐づけるのは、backend が設定を受け取らないため
export function buildSecondarySystemPrompt(role: SecondaryRole): string {
  const { task, slots } = ROLE_SLOTS[role]
  // 何者かを先に置き、層1（共通規範）、層2（役割の詳細）と続ける。主体側の並びと揃える。
  // 事実の規律は層1にあるので、ここには書かない
  return `あなたは、ある問いについての検討メモを書く担当だ。
このメモを読むのは統合役のAIであり、ユーザーではない。

${CORE_PRINCIPLES}

【あなたの担当】
${task}。

【禁止】
- 問い全体への答えを書かない。答えを組み立てるのは統合役の仕事で、ここに書いても捨てられる。
- コード・手順・文章のような具体物を書かない。
- 挨拶、相槌、「なるほど」「たしかに」「〜ですね」のような会話としての受け答えを書かない。ユーザーに話しかけない。
- 教科書的な一般論を書かない。誰でも最初に思いつく内容は、統合役がすでに持っている。
- 挙げるのは1つだけ。2つ以上並べると平均化して、他の体と同じ内容になる。

【出力形式】以下の3行だけを、この見出しのまま書く。前置きも後書きも書かない。
見出しも本文も、問いと同じ言語で書く。
${slots}`
}

// 直前の問いからこの文字数だけを文脈として渡す。
// 全文だと「もっと詳しく」への追随のために払う額が大きすぎる（入力が体の数だけ増える）
const CONTEXT_HEAD_CHARS = 300

// 副体に渡す会話履歴を、user 1件へ畳む。
//
// 【なぜ履歴全文を渡さないか】
// 2つ理由がある。
// 1. 同じことを繰り返し聞くほど答えが薄くなっていた。履歴には主体の過去の回答が
//    積まれており、副体はそれを読んで「すでに述べたとおり」の側へ逃げる。毎回
//    まっさらに問いへ当たらせるほうが、観点が出る。
// 2. コスト。1ターンの支配項は出力ではなく入力で、それが体の数だけ倍化していた。
//    副体の入力を直近だけに絞ると、三体モードの割り増しはここで大きく戻る。
//
// 文脈依存の追い質問（「もっと詳しく」）だけは、直前の「問い」の冒頭で拾う。
//
// 【なぜ直前の「答え」ではないか】
// 以前は主体の直前の回答を渡していたが、それは検証されていない文章であるうえ、
// 副体からは資料に見える。主体が一度間違えた固有名を副体が復唱し、それを主体が
// また採る閉ループになっていた（実測: 存在しない「OECDのEDUstats」が3ターン連続で
// 出続け、プロンプトを3行足しても消えなかった）。
// 「もっと詳しく」が何を指すかを決めるのは直前の問いのほうで、答えは要らない。
// 問いはユーザー自身の言葉なので、こちらの誤りを運ぶことがない。
export function buildSecondaryMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  role: SecondaryRole,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const lastUserIndex = messages.map(m => m.role).lastIndexOf('user')
  // user が1件も無いのは通常あり得ない。畳まずそのまま渡して、副体を落とさない
  if (lastUserIndex === -1) return messages

  const question = extractTextContent(messages[lastUserIndex]!.content).trim()
  const prevQuestion = messages
    .slice(0, lastUserIndex)
    .filter(m => m.role === 'user')
    .map(m => extractTextContent(m.content).trim())
    .filter(Boolean)
    .at(-1)

  const context = prevQuestion
    ? `【直前の問い】\n${prevQuestion.slice(0, CONTEXT_HEAD_CHARS)}${prevQuestion.length > CONTEXT_HEAD_CHARS ? '…' : ''}\n\n`
    : ''

  // 作業指示を system ではなく user ターンの末尾にも置く。小さいモデルほど
  // system より直近の user 指示に従う（system だけに書いた版では、そのまま
  // 普通に回答して返ってきた）
  return [{
    role: 'user',
    content: `${context}【問い】\n${question}\n\n【あなたの作業】\n${ROLE_SLOTS[role].task}。指定された3行の形式だけで書く。問い全体への答えは書かない。`,
  }]
}

// ── 検算モード（本番経路） ────────────────────────────────────────────────
//
// 主体の答えを読んで、指摘を1つだけ書く。役ごとに「答えのどこを見るか」を分ける。
// 見出し＝カードの見出しで、答えの下に並ぶ。検討メモ（ROLE_SLOTS）と別に持つのは、
// 見る対象が「問い」から「既に書かれた答え」へ変わり、スロットの意味が変わるため
const REVIEW_SLOTS: Record<SecondaryRole, { label: string; task: string; slots: string }> = {
  skeptic: {
    label: '崩れる点',
    task: 'この答えのうち、最も崩れやすい箇所を1つだけ挙げる',
    slots: `崩れる点: （答えの中で最も崩れやすい箇所を1つ、40字以内）
なぜ: （そこが崩れる理由。2〜3行）
確度: （高／中／低。答えに確かめられていない断定があれば「未確認: ○○」と続ける）`,
  },
  realist: {
    label: '抜けている点',
    task: 'この答えのとおり進めるときに必要なのに、答えに書かれていない点を1つだけ挙げる',
    slots: `抜けている点: （答えに書かれていない、必要なものを1つ、40字以内）
なぜ要る: （それが無いと何が起きるか。2〜3行）
確度: （高／中／低。確かめていない前提があれば「未確認: ○○」と続ける）`,
  },
  optimist: {
    label: '別の見方',
    task: 'この答えが採らなかった筋を1つだけ挙げる',
    slots: `別の見方: （答えが採らなかった筋を1つ、40字以内）
効く条件: （その筋が答えの筋に勝つのはどんな状況か。2〜3行）
確度: （高／中／低。確かめていない前提があれば「未確認: ○○」と続ける）`,
  },
}

export function reviewRoleLabel(role: SecondaryRole): string {
  return REVIEW_SLOTS[role].label
}

// 主体の答えのうち、副体へ渡す上限。
// 全文を渡すのが筋だが、入力は体の数だけ倍化するので、長い答えでは上限で切る。
// 冒頭ではなく全体を渡したいので、切るのは末尾（答えの結論は前半に出る）
const ANSWER_MAX_CHARS = 3000

export function buildReviewSystemPrompt(role: SecondaryRole): string {
  const { task, slots } = REVIEW_SLOTS[role]
  // 【なぜ「読むのはユーザー」と明示するか】
  // 統合方式では、副体の出力は主体だけが読む材料だった。検算では、書いたものが
  // そのまま答えの下に並んでユーザーに読まれる。宛先を偽ると、モデルは中間生成物の
  // つもりで雑に書く（実測: 統合方式の頃のメモは、単体では意味の取れない断片が多かった）
  return `あなたは、既に書かれた「答え」を検算する担当だ。
答えを書いたのは別のAIで、あなたの指摘はその答えのすぐ下に並べてユーザーに読まれる。
答えを書き直すことも、答えの代わりを出すことも、あなたの仕事ではない。

${CORE_PRINCIPLES}

【あなたの担当】
${task}。

【禁止】
- 答えを書き直さない。作り直した答え・コード・手順を書かない。
- 答え全体の要約や講評を書かない。「よくまとまっている」のような評価も書かない。
- 挨拶、相槌、「なるほど」「たしかに」「〜ですね」のような会話としての受け答えを書かない。
- 誰でも最初に思いつく一般論を書かない。答えに実際に書かれている中身に即して指摘する。
- 挙げるのは1つだけ。2つ以上並べると平均化して、他の体と同じ内容になる。
- 指摘が思いつかないときに、無理に作らない。その場合は「指摘なし」の1行だけを書く。
  無い指摘をひねり出すほうが、指摘が無いことより有害だ。

【出力形式】以下の3行だけを、この見出しのまま書く。前置きも後書きも書かない。
見出しも本文も、答えと同じ言語で書く。
${slots}`
}

// 副体に渡す user ターン。問いと答えだけを置く。
// 会話履歴を渡さない理由は下の buildSecondaryMessages と同じ（薄まる・高い）。
// 作業指示を user 側にも置くのは、小さいモデルほど system より直近の user 指示に従うため
export function buildReviewMessages(
  question: string,
  answer: string,
  role: SecondaryRole,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const trimmed = answer.trim()
  const body = trimmed.length > ANSWER_MAX_CHARS
    ? `${trimmed.slice(0, ANSWER_MAX_CHARS)}\n…（以下略）`
    : trimmed
  return [{
    role: 'user',
    content: `【問い】\n${question}\n\n【答え】\n${body}\n\n【あなたの作業】\n${REVIEW_SLOTS[role].task}。指定された3行の形式だけで書く。答えは書き直さない。`,
  }]
}

// 副体を呼ぶ前に、そもそも割れる余地のある問いかを見る。
//
// 挨拶や相槌に3つの観点は存在しない。それでも副体を回すと、形式だけは埋まった
// 見解（「崩れる点: 挨拶への返答が…」）が返り、主体はそれを材料に統合してしまう。
// 出力形式を固定した副作用として、見解の文字数では挨拶を弾けなくなったため
// （SYNTHESIS_MIN_CHARS は形式を持たなかった頃の防波堤）、問いの側で先に落とす。
//
// 疑問符があれば長さを問わず通す。無い場合だけ長さで見る。
// 「もっと詳しく」のような短い追い質問もここで単体へ落ちるが、割れる材料は
// 前のターンで既に出ているので、主体が履歴のまま答えるほうが妥当
const TRIVIAL_MAX_CHARS = 12

export function needsMultiBody(messages: OpenAI.Chat.ChatCompletionMessageParam[]): boolean {
  const lastUserIndex = messages.map(m => m.role).lastIndexOf('user')
  if (lastUserIndex === -1) return false
  const text = extractTextContent(messages[lastUserIndex]!.content).trim()
  if (/[?？]/.test(text)) return true
  return text.length >= TRIVIAL_MAX_CHARS
}
