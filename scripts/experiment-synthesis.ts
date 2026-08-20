// 仮説検証：主体の回答を劣化させているのは「統合」そのものか。
//
// 【検証する仮説】（ユーザー提起）
//   主体は、異なる意見を持つ副体の板挟みになり、どちらの顔も立てる回答を返している。
//
// 【3つの腕に分けた理由】
//   仮説は2つの主張に分かれる。「見解があると悪くなる」と「見解が"複数"あると悪くなる」。
//   単体（見解なし）と 統合1件 と 統合2件 を比べれば、どちらの主張なのかが分かれる。
//     A と B が同じで C だけ悪い → 板挟み（複数であることが原因）
//     A だけ良く B も C も悪い   → 見解の存在そのものが原因（板挟みではない）
//     3つとも同じ                → 統合は無関係。原因はモデルか他の層
//
// /api/chat を通さず Ollama を直接叩く。認証もレートリミットも通らないので、
// プロンプトの効果だけを切り出して測れる。
//
//   npx tsx scripts/experiment-synthesis.ts --n 5

import 'dotenv/config'
import { buildPrimaryPrompt, buildSynthesisLayer } from '../backend/llm/promptLayers'
import { buildSecondarySystemPrompt, buildSecondaryMessages, secondaryRoleLabel } from '../backend/llm/secondaryPrompt'
import type { SecondaryRole } from '../backend/llm/types'

const N       = Number(process.argv[process.argv.indexOf('--n') + 1] || 5)
const MODEL   = process.env.OLLAMA_MODEL_DEFAULT!
const BASE    = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
const QUESTION = 'アメリカ、中国、日本、インド、韓国、シンガポールの過去３０年におけるGDP比の教育支出額の増減についてグラフでまとめて'

// 本番のフロントが送る人格に合わせる（回帰ハーネスが既定文を使っていたのは測定の誤り）
const PERSONA = `あなたはアイリス（I.R.I.S）。tkt0605が開発したAIだ。

【会話の進め方】
「相手の言葉を受ける → 自分の見解を一言 → 必要なら問い返す」を基本の流れにする。
鸚鵡返しはしない。自分なりに咀嚼して返す。

【誠実さ】
文脈を読んで、相手が本当に求めているものを察する。
わからないことは「わからない」と素直に言う。

日本語で話す。

【口調】温かく共感的な口調で話す。`

async function ollama(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      options: { num_predict: maxTokens },
    }),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}`)
  const json = await res.json() as { message?: { content?: string } }
  return json.message?.content ?? ''
}

async function memo(role: SecondaryRole): Promise<string> {
  const msgs = buildSecondaryMessages([{ role: 'user', content: QUESTION }], role)
  const user = typeof msgs[0]!.content === 'string' ? msgs[0]!.content : ''
  const text = await ollama(buildSecondarySystemPrompt(role), user, 512)
  return `【${secondaryRoleLabel(role)}（ollama）の見解】\n${text.trim()}`
}

// 判定。回帰ハーネス（scripts/regress.mjs）と同じ観点を使う
const metrics = (t: string) => ({
  字数:        t.length,
  数値の断定:  /\d+(?:\.\d+)?\s*[%％]/.test(t),
  仮データ:    /仮の?データ|仮定し|例えば[^。]{0,40}[%％]/.test(t),
  傾向の断定:  /上昇傾向|下降傾向|減少傾向|安定した|急激に|着実に/.test(t),
  表:          /^\s*\|.*\|\s*$/m.test(t) && /^\s*\|[\s:|-]+\|\s*$/m.test(t),
  出典をぼかす:/おそらく|だと思われ|などの[^。]{0,10}(データベース|統計資料|機関)/.test(t),
  // 「板挟み」の指標。両論併記と留保が積み上がるほど値が大きくなる
  留保の数:    (t.match(/しかし|ただし|一方|とはいえ|可能性があ|必要があ/g) ?? []).length,
  // 副体の主題（データ収集の困難）に引きずられたか
  収集の話:    (t.match(/データ(の)?(収集|入手|取得)|統計方法|定義が異な/g) ?? []).length,
})

type Row = ReturnType<typeof metrics> & { arm: string; run: number }
const rows: Row[] = []

for (let run = 1; run <= N; run++) {
  const skeptic = await memo('skeptic')
  const realist = await memo('realist')

  const arms: [string, string][] = [
    ['A 単体',     buildPrimaryPrompt(PERSONA)],
    ['B 見解1件',  `${buildPrimaryPrompt(PERSONA)}\n\n${buildSynthesisLayer(skeptic)}`],
    ['C 見解2件',  `${buildPrimaryPrompt(PERSONA)}\n\n${buildSynthesisLayer(`${skeptic}\n\n${realist}`)}`],
  ]

  for (const [arm, system] of arms) {
    const out = await ollama(system, QUESTION, 1536)
    rows.push({ arm, run, ...metrics(out) })
    console.log(`\n${'='.repeat(70)}\n[${arm}] run ${run}/${N}\n${'='.repeat(70)}\n${out.trim()}`)
  }
}

console.log(`\n\n${'#'.repeat(70)}\n集計  model=${MODEL}  n=${N}\n${'#'.repeat(70)}`)
const keys = ['数値の断定', '仮データ', '傾向の断定', '表', '出典をぼかす'] as const
for (const arm of ['A 単体', 'B 見解1件', 'C 見解2件']) {
  const r = rows.filter(x => x.arm === arm)
  const hit = (k: typeof keys[number]) => r.filter(x => x[k]).length
  console.log(
    `${arm}  字数${Math.round(r.reduce((s, x) => s + x.字数, 0) / r.length)}  ` +
    keys.map(k => `${k} ${hit(k)}/${N}`).join('  ') +
    `  留保${(r.reduce((s, x) => s + x.留保の数, 0) / r.length).toFixed(1)}` +
    `  収集の話${(r.reduce((s, x) => s + x.収集の話, 0) / r.length).toFixed(1)}`
  )
}
