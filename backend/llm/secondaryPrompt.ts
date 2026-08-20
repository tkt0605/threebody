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

// 直前の応答からこの文字数だけを文脈として渡す。
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
// 文脈依存の追い質問（「もっと詳しく」）だけは直前の応答の冒頭で拾う
export function buildSecondaryMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  role: SecondaryRole,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const lastUserIndex = messages.map(m => m.role).lastIndexOf('user')
  // user が1件も無いのは通常あり得ない。畳まずそのまま渡して、副体を落とさない
  if (lastUserIndex === -1) return messages

  const question = extractTextContent(messages[lastUserIndex]!.content).trim()
  const prevAssistant = messages
    .slice(0, lastUserIndex)
    .filter(m => m.role === 'assistant')
    .map(m => extractTextContent(m.content).trim())
    .filter(Boolean)
    .at(-1)

  const context = prevAssistant
    ? `【これまでの流れ】\n${prevAssistant.slice(0, CONTEXT_HEAD_CHARS)}${prevAssistant.length > CONTEXT_HEAD_CHARS ? '…' : ''}\n\n`
    : ''

  // 作業指示を system ではなく user ターンの末尾にも置く。小さいモデルほど
  // system より直近の user 指示に従う（system だけに書いた版では、そのまま
  // 普通に回答して返ってきた）
  return [{
    role: 'user',
    content: `${context}【問い】\n${question}\n\n【あなたの作業】\n${ROLE_SLOTS[role].task}。指定された3行の形式だけで書く。問い全体への答えは書かない。`,
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
