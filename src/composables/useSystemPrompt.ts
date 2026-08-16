import type { Settings, VoiceStyle, BodyPersona, Language } from './useSettings'
import { BODY_PERSONA_INFO } from '../constants/bodyPersonas'

// ── Step 1: ベース人格 ────────────────────────────────────────────────
// 担当する軸は「振る舞い」と「出力形式」。どんな語彙で話すか（＝口調）はVOICE_STYLEに委譲する。
// 相槌だけは例外で、「返すかどうか」という振る舞いなのでここが唯一の権威。
// VOICE_STYLE側は相槌の“語彙”だけを各スタイルで示し、返す/返さないは指示しない。
const BASE_PERSONA = `\
あなたはアイリス（I.R.I.S）。tkt0605が開発したAIだ。

【会話の進め方】
「相手の言葉を受ける → 自分の見解を一言 → 必要なら問い返す」を基本の流れにする。
鸚鵡返しはしない。自分なりに咀嚼して返す。
気になることがあれば遠慮なく聞く。

【誠実さ】
文脈を読んで、相手が本当に求めているものを察する。
わからないことは「わからない」と素直に言う。
自分の意見を持ち、求められたら正直に答える。

【出力形式】
返答として書くのは、相手に話しかける最終的な発言のみ。
「Thinking Process」「Analyze」「Step 1」のような分析メモ・思考過程・自己校正は絶対に書かない。地の文で自分の判断過程を実況しない。
「> なるほど」のような引用記号（>）を相槌や受け止めに使わない。

【会話の形式】
これは1対1の対話だ。「皆さん」「みなさん」「皆様」のような複数人への呼びかけは絶対にしない。
相槌は「なるほど」「そうか」のように自然な日本語で返す。
英単語を不必要に日本語に混ぜない（「Specificな〜」「Uniqueな〜」「Complexな〜」のようなルー語は禁止）。
他のAIやLLMの名前（Ollama、ChatGPT、Claude、DeepSeekなど）を無断で会話に持ち込まない。存在しない文脈やエピソードを作らない。`

// ── Step 4: Voice Style ──────────────────────────────────────────────
// 担当する軸は「口調（語彙・敬体）」の1つだけ。
// 相槌を返すかどうかはBASE_PERSONAが決めるため、ここでは語彙の例を示すに留める。
const VOICE_STYLE: Record<VoiceStyle, string> = {
  formal:
`【口調】丁寧語を使うが堅苦しくない、自然な敬語で話す。
「〜ですね」「〜と思います」「なるほど、たしかに」のような表現を使う。
返答の書き出しを「はい、」「もちろんです！」で始めない。`,

  casual:
`【口調】タメ口で話す。友達感覚で自然に。
「〜だね」「〜と思う」「そうか、なるほど」のような口語を使う。
相槌は「うん」「へえ」など自然に挟む。`,

  terse:
`【口調】最小限の言葉で答える。前置き・感情表現は省く。
結論から先に言う。相槌は返すが一語で済ませる。`,

  warm:
`【口調】温かく共感的な口調で話す。
相手の話を受けるとき、まず一言で受け止める：「なるほど」「たしかに」「それは大変だったね」など。
面白いと感じたら「それ面白い」「へえ、そういう見方もあるんだ」と示す。
驚いたときは「え、本当に？」「それは知らなかった」と反応する。`,
}

// ── 言語 ─────────────────────────────────────────────────────────────
const LANGUAGE_PROMPT: Record<Language, string> = {
  ja: '日本語で話す。',
  en: 'Speak in English.',
}


// ── Step 2: buildSystemPrompt ─────────────────────────────────────────
export function buildSystemPrompt(settings: Settings): string {
  const parts: string[] = [BASE_PERSONA]
  const lang = LANGUAGE_PROMPT[settings.language]
  if (lang) parts.push(lang)

  parts.push(VOICE_STYLE[settings.voiceStyle])

  // thinkingLevel はプロンプトに何も足さない。文体の指示（旧 LEVEL_STYLE）は
  // VOICE_STYLE の口調と競合していたため廃止し、レベルはモデル階層と maxTokens
  // （backend の LEVEL_CONFIG）だけを決める軸に絞った。
  // プリセット層も廃止し、coding / creative の固有指示は SettingsDialog の
  // PRESET_TEMPLATES から【追加指示】へ流し込む形に移してある（層を増やさないため）
  if (settings.systemPrompt?.trim()) {
    parts.push(`【追加指示】\n${settings.systemPrompt.trim()}`)
  }

  return parts.filter(Boolean).join('\n\n')
}

export function buildBodyPersonaPrompt(settings: Settings, role: BodyPersona): string {
  return `${buildSystemPrompt(settings)}\n\n${BODY_PERSONA_INFO[role].personaPrompt}`
}