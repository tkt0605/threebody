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
// スロットは4フィールド固定（判定／対象箇所／根拠／代替案）。役ごとに変えるのは
// 「どこを見るか」の指示文だけで、フィールド名自体は揃える。
//
// 【なぜ以前の3行（見出し/理由/確度）をやめたか】
// 見出し行が「カードの見出し」と「判定」を兼ねていたため、コード側は1行目の文字列に
// 「指摘なし」が含まれるかしか見れず（hasReviewFinding）、対象箇所が答えに実在するかは
// 誰も検証していなかった。判定と対象箇所を別フィールドに分けることで、
// 対象箇所＝答えからの引用であることをコード側で照合できるようにする
const REVIEW_SLOTS: Record<SecondaryRole, { label: string; task: string; slots: string }> = {
  skeptic: {
    label: '崩れる点',
    task: 'この答えのうち、最も崩れやすい箇所を1つだけ挙げる',
    slots: `判定: （指摘あり／指摘なし）
            対象箇所: （最も崩れやすい箇所を、答えの本文から引用する。要約・言い換えはしない。60字以内。指摘なしのときは「―」）
            根拠: （そこが崩れる理由。2〜3行。答えに確かめられていない断定があれば「未確認: ○○」と続ける）  
            代替案: （その崩れを避けるには何を直すべきか。1行。指摘なしのときは「―」）`,
  },
  realist: {
    label: '抜けている点',
    task: 'この答えのとおり進めるときに必要なのに、答えに書かれていない点を1つだけ挙げる',
    slots: `判定: （指摘あり／指摘なし）
            対象箇所: （抜けが関わる箇所を、答えの本文から引用する。要約・言い換えはしない。60字以内。指摘なしのときは「―」）
            根拠: （それが無いと何が起きるか。2〜3行。確かめていない前提があれば「未確認: ○○」と続ける）
            代替案: （何を補えばよいか。1行。指摘なしのときは「―」）`,
  },
  optimist: {
    label: '別の見方',
    task: 'この答えが採らなかった筋を1つだけ挙げる',
    slots: `判定: （指摘あり／指摘なし）  
            対象箇所: （答えが採った筋を示す箇所を、答えの本文から引用する。要約・言い換えはしない。60字以内。指摘なしのときは「―」）
            根拠: （別の筋が答えの筋に勝つのはどんな状況か。2〜3行。確かめていない前提があれば「未確認: ○○」と続ける）
            代替案: （採るべき別の筋を1行で。指摘なしのときは「―」）`,
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
- 対象箇所は答えの文言を変えずに引用する。要約・言い換え・でっち上げをしない。
  答えに実在しない引用は、判定を「指摘あり」にしていても指摘ごと捨てられる。
- 指摘が思いつかないときに、無理に作らない。その場合は判定に「指摘なし」とだけ書き、
  対象箇所と代替案には「―」を書く。無い指摘をひねり出すほうが、指摘が無いことより有害だ。

【出力形式】以下の4行だけを、この見出しのまま書く。前置きも後書きも書かない。
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
    content: `【問い】\n${question}\n\n【答え】\n${body}\n\n【あなたの作業】\n${REVIEW_SLOTS[role].task}。指定された4行の形式だけで書く。対象箇所は答えからの引用のみ。答えは書き直さない。`,
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

// 「指摘が出たか」を真偽値で持たせるための判定。
//
// 副体は指摘が思いつかないとき判定に「指摘なし」と書く（buildReviewSystemPrompt の禁止事項）。
// これを本文の文字列でしか判別できないと、読む側それぞれが自前で文字列を見ることになり、
// 文面が揺れた瞬間に静かに壊れる。判定はここ1箇所に置き、結果を SSE の body_done と
// content_blocks の payload（BodyPerspective.hasFinding）へ構造として載せる。
//
// 空文字は false。副体が落ちたときは全文が空のまま body_done が飛ぶ（textService の
// finally）ので、「指摘が無かった」ではなく「カードが欠けた」状態だが、
// どちらも "指摘は出ていない" 側なので同じ false でよい。
//
// 判定は「判定:」フィールドを見る。見つからない（形式が崩れた）出力だけ1行目へ落ちる。
//
// [要判断] 判定できるのは日本語だけ。副体は「答えと同じ言語で書く」ので、英語の答えには
// "No issues" が返る。日本語以外を扱い始めるときに拡張する
const NO_FINDING_PATTERN = /指摘(は)?(特に)?(ありません|ございません|なし|無し)/

// 引用として認める最短の連続一致長（空白等を除いた後）。これより短いと答えのほぼ
// どの一文にも部分一致してしまい、「引用の強制」が意味を持たなくなる
const MIN_QUOTE_CHARS = 6

// 空白・改行・引用符の違いだけで照合が壊れないようにする（副体は対象箇所を
// 「」で囲んだり、句読点の前後にスペースを入れたりすることがある）
function normalizeForQuoteCheck(s: string): string {
  return s.replace(/[\s「」『』"'’“”…]/g, '')
}

// 対象箇所「全体」が答えの部分文字列である必要はない。実際のモデル出力は
// 「GET /api/todos」のように答えを引用しつつ、それを説明する地の文を同じ行に
// 混ぜて書く（禁止事項で「一字一句引用する」と明示しても、この書き方は消えなかった）。
// 見るのは「MIN_QUOTE_CHARS文字以上、答えと連続一致する区間が対象箇所の中に
// 1つでもあるか」だけ。これなら地の文が混ざっていても本物の引用は拾えるし、
// 一致区間が皆無なでっち上げ（実測: 存在しない「OECDのEDUstats」）は依然として弾ける

// パラメータ値はそれぞれtargetとanswerという文字列・戻り値はboolean(true or false)
function hasQuotedSpan(target: string, answer: string): boolean {
  //targetとanswerの二つの文書を正規化し、それぞれを変数で格納している。
  const normalizedTarget = normalizeForQuoteCheck(target)
  const normalizedAnswer = normalizeForQuoteCheck(answer)
  // targetの文字列が MIN_QUOTE_CHARSよりも短い時はfalseを返す。
  if (normalizedTarget.length < MIN_QUOTE_CHARS) return false
  // targetの文字数がoから始まり1個ずつ増えていく中で文字数がはみ出さないところまでループを続ける。
  for (let i = 0; i + MIN_QUOTE_CHARS <= normalizedTarget.length; i++) {
    // インデックスiからMIN_QUOTE_CHARSまでの文字分だけを切り出してAnswerにそのまま服割れていたら true
    if (normalizedAnswer.includes(normalizedTarget.slice(i, i + MIN_QUOTE_CHARS))) return true
  }
  return false
}

// content から「ラベル: 値」の値だけを取り出す。ラベルが行頭に無ければ null
function extractField(content: string, label: string): string | null {
  // .split('~')の設計意図は？
  const line = content.split('\n').find((l) => {
    //　上で見つけたものをlとし、l全体の文書を変数tとして格納
    const t = l.trim()
    // ここもわからん。
    return t.startsWith(`${label}:`) || t.startsWith(`${label}：`)
  })
  if (line === undefined) return null
  // 変数lineの文書を今探しているこの label 自身の文字数でスライス
  return line.trim().slice(label.length + 1).trim()
}

// 「判定」と「対象箇所」の2フィールドで見る。
//
// 判定だけを見ていた旧実装では、モデルが「指摘あり」と書きさえすれば対象箇所が
// 答えに実在するかは誰も確かめていなかった（docs/ROADMAP.md②の完了判定「副体の指摘が
// 主体の答えに実際に書かれている中身を指している」は、この検証が無いと自動では守れない）。
// 対象箇所は答えからの一字一句の引用を要求しており（buildReviewSystemPrompt）、
// answer に実在しない・短すぎて実質どこにでも一致する場合は、判定が「指摘あり」でも
// false へ倒す。でっち上げた対象箇所を「指摘あり」のまま SSE / content_blocks へ流すと、
// ⑤（実例の自動公開）に答えを指していない指摘が実例として紛れ込む
export function hasReviewFinding(content: string, answer: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  const verdict = extractField(trimmed, '判定') ?? trimmed.split('\n')[0] ?? ''
  if (NO_FINDING_PATTERN.test(verdict)) return false

  const target = extractField(trimmed, '対象箇所')
  if (!target) return false
  return hasQuotedSpan(target, answer)
}
