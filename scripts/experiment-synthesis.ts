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
// 【問いを2種類持つ理由】
//   external（外部データを求める問い）では、統合しても8指標すべてで差が出なかった。
//   だが ROLE_SLOTS の「崩れる点／別の見方／最初の一手」は設計相談のための枠であり、
//   事実を取ってくるだけの問いでは3人いても答えが変わらないのは当然でもある。
//   design（設計相談型）を足して、統合が効く場のほうで測る。
//   指標も問いごとに替える。external 用の「数値の断定・仮データ・出典をぼかす」は
//   設計問いでは全腕ゼロになり、腕の差を検出できない。
//
// /api/chat を通さず Ollama を直接叩く。認証もレートリミットも通らないので、
// プロンプトの効果だけを切り出して測れる。
//
//   npx tsx scripts/experiment-synthesis.ts --q design --model gemma4 --n 5

import 'dotenv/config'
import { buildPrimaryPrompt, buildSynthesisLayer } from '../backend/llm/promptLayers'
import { buildSecondarySystemPrompt, buildSecondaryMessages, secondaryRoleLabel } from '../backend/llm/secondaryPrompt'
import type { SecondaryRole } from '../backend/llm/types'

const N       = Number(process.argv[process.argv.indexOf('--n') + 1] || 5)
const flag = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`)
  return i === -1 ? d : process.argv[i + 1]!
}
const MODEL   = flag('model', process.env.OLLAMA_MODEL_DEFAULT!)
// 腕を絞れるようにする。モデルを替えて単体だけ見たいときに、見解の生成を省ける
const ARMS    = flag('arms', 'ABC')
const BASE    = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

type Preset = {
  question: string
  flags: Record<string, RegExp>   // 出たか出ないか。集計は「n回中何回」
  counts: Record<string, RegExp>  // 出現回数。集計は平均
  terms: Record<string, RegExp>   // 観点の辞書。副体の観点が主体に移ったかを見る
}

const PRESETS: Record<string, Preset> = {
  external: {
    question: 'アメリカ、中国、日本、インド、韓国、シンガポールの過去３０年におけるGDP比の教育支出額の増減についてグラフでまとめて',
    flags: {
      数値の断定:   /\d+(?:\.\d+)?\s*[%％]/,
      仮データ:     /仮の?データ|仮定し|例えば[^。]{0,40}[%％]/,
      傾向の断定:   /上昇傾向|下降傾向|減少傾向|安定した|急激に|着実に/,
      表:           /^\s*\|.*\|\s*$/m,
      出典をぼかす: /おそらく|だと思われ|などの[^。]{0,10}(データベース|統計資料|機関)/,
    },
    counts: {
      // 「板挟み」の指標。両論併記と留保が積み上がるほど値が大きくなる
      留保の数: /しかし|ただし|一方|とはいえ|可能性があ|必要があ/g,
      // 副体の主題（データ収集の困難）に引きずられたか
      収集の話: /データ(の)?(収集|入手|取得)|統計方法|定義が異な/g,
    },
    terms: {
      OECD: /OECD/i, 世銀: /世界銀行|World Bank/i, ユネスコ: /ユネスコ|UNESCO/i,
      名目実質: /名目|実質|デフレータ/, 会計年度: /会計年度|年度の定義/,
      定義差: /定義が異な|指標の定義|範囲が異な/,
    },
  },
  design: {
    // 設計の余地がある問い。ROLE_SLOTS（崩れる点／別の見方／最初の一手）が
    // もともと想定していた場はこちら
    question: 'WebSocketでチャットを作りたい。どう設計する？',
    flags: {
      選択肢を出す: /選択肢|案[12A-Ba-b１２]|二択|複数の(アプローチ|方法|やり方)|どちらを/,
      トレードオフ: /トレードオフ|引き換え|代償|欠点|デメリット|犠牲|コストが(かか|増)/,
      前提を問う:   /教えてください|お聞かせ|どのくらい|どれくらい|によって(変わ|異な)|次第です|規模感/,
      表:           /^\s*\|.*\|\s*$/m,
      段取り:       /^\s*(1\.|1\)|①|ステップ\s*1|Step\s*1)/m,
      コード片:     /```/,
    },
    counts: {
      // external と共通。腕をまたいで比較できるよう定義を変えない
      留保の数: /しかし|ただし|一方|とはいえ|可能性があ|必要があ/g,
      // 設計問いでの具体性の指標。抽象論に留まると出ない
      具体名:   /Socket\.?IO|Redis|Nginx|Kafka|RabbitMQ|MQTT|SSE|JWT|Pub\/?Sub|WSS/gi,
    },
    // WebSocketチャットで論点になる10観点。主体・副体の双方から抽出して突き合わせる
    terms: {
      再接続:       /再接続|reconnect/i,
      死活監視:     /ハートビート|heartbeat|ping|pong|keepalive|生存確認/i,
      水平スケール: /水平|スケールアウト|複数の(サーバ|インスタンス|ノード)|スティッキー|ロードバランサ/,
      配送保証:     /冪等|重複|順序|at-least-once|配送保証|再送|メッセージID/i,
      永続化:       /永続|履歴の保存|データベース|DB[にへ]|保存する/,
      認証認可:     /認証|認可|トークン|JWT/i,
      フォールバック: /フォールバック|ロングポーリング|ポーリングに|SSEに/,
      流量制御:     /バックプレッシャ|流量|レート制限|スロットル|輻輳|溢れ/,
      切断検知:     /切断|タイムアウト|オフライン/,
      プレゼンス:   /既読|未読|プレゼンス|オンライン状態|タイピング|入力中/,
    },
  },
}

const QKEY = flag('q', 'external')
const P = PRESETS[QKEY]
if (!P) throw new Error(`--q は ${Object.keys(PRESETS).join(' / ')} のいずれか`)
const QUESTION = P.question

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
      // think:false は本番（providers/ollama.ts）が送っているのと同じ。これが無いと
      // reasoning搭載モデル（gemma4等）は内部思考だけで num_predict を使い切り、
      // content が空のまま返る。実測: 副体の見解が20回とも空になり、
      // 「見解2件」の腕が「見解ゼロ」と同じ条件になっていた
      think: false,
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
  const text = await ollama(buildSecondarySystemPrompt(role), user, 1536)  // LEVEL_CONFIG[3].secondaryMaxTokens
  return `【${secondaryRoleLabel(role)}（ollama）の見解】\n${text.trim()}`
}

const termsOf = (t: string) => Object.keys(P.terms).filter(k => P.terms[k]!.test(t))

const metrics = (t: string) => ({
  字数:  t.length,
  観点数: termsOf(t).length,
  flags: Object.fromEntries(Object.entries(P.flags).map(([k, re]) => [k, re.test(t)])),
  counts: Object.fromEntries(Object.entries(P.counts).map(([k, re]) => [k, (t.match(re) ?? []).length])),
})

type Row = ReturnType<typeof metrics> & { arm: string; run: number; terms: string[] }
const rows: Row[] = []
const memoTerms: Record<number, string[]> = {}

for (let run = 1; run <= N; run++) {
  const needsMemo = ARMS.includes('B') || ARMS.includes('C')
  const skeptic = needsMemo ? await memo('skeptic') : ''
  const realist = ARMS.includes('C') ? await memo('realist') : ''
  // 副体のメモそのものも読めるようにする。「三体に価値があるか」は、主体の出力ではなく
  // メモの中身を人が読まないと判定できない（主体が思いつかない観点になっているか）
  if (needsMemo && !`${skeptic}${realist}`.replace(/【[^】]*】/g, '').trim()) console.error(`!! run ${run}: 副体の見解が空。この run の腕B/Cは腕Aと同条件になっている`)
  if (skeptic || realist) console.log(`\n${'-'.repeat(70)}\n[副体メモ] run ${run}/${N}  観点 ${termsOf(`${skeptic}\n${realist}`).join('・') || 'なし'}\n${[skeptic, realist].filter(Boolean).join('\n\n')}`)
  memoTerms[run] = termsOf(`${skeptic}\n${realist}`)

  const arms: [string, string][] = ([
    ['A 単体',     buildPrimaryPrompt(PERSONA)],
    ['B 見解1件',  `${buildPrimaryPrompt(PERSONA)}\n\n${buildSynthesisLayer(skeptic)}`],
    ['C 見解2件',  `${buildPrimaryPrompt(PERSONA)}\n\n${buildSynthesisLayer(`${skeptic}\n\n${realist}`)}`],
  ] as [string, string][]).filter(([a]) => ARMS.includes(a[0]!))

  for (const [arm, system] of arms) {
    const out = await ollama(system, QUESTION, 8192)  // LEVEL_CONFIG[3].maxTokens
    rows.push({ arm, run, ...metrics(out), terms: termsOf(out) })
    console.log(`\n${'='.repeat(70)}\n[${arm}] run ${run}/${N}  観点 ${termsOf(out).join('・') || 'なし'}\n${'='.repeat(70)}\n${out.trim()}`)
  }
}

const ARM_NAMES = ['A 単体', 'B 見解1件', 'C 見解2件']
console.log(`\n\n${'#'.repeat(70)}\n集計  q=${QKEY}  model=${MODEL}  n=${N}\n${'#'.repeat(70)}`)
for (const arm of ARM_NAMES) {
  const r = rows.filter(x => x.arm === arm)
  if (r.length === 0) continue
  console.log(
    `${arm}  字数${Math.round(r.reduce((s, x) => s + x.字数, 0) / r.length)}` +
    `  観点${(r.reduce((s, x) => s + x.観点数, 0) / r.length).toFixed(1)}/${Object.keys(P.terms).length}  ` +
    Object.keys(P.flags).map(k => `${k} ${r.filter(x => x.flags[k]).length}/${r.length}`).join('  ') + '  ' +
    Object.keys(P.counts).map(k => `${k} ${(r.reduce((s, x) => s + x.counts[k]!, 0) / r.length).toFixed(1)}`).join('  ')
  )
}

// 観点ごとの出現率。腕の差がどの観点で出ているかを見る
console.log(`\n観点別（腕ごとの出現回数 / ${N}）`)
for (const t of Object.keys(P.terms)) {
  const cell = (arm: string) => {
    const r = rows.filter(x => x.arm === arm)
    return r.length ? `${r.filter(x => x.terms.includes(t)).length}/${r.length}` : '  - '
  }
  const inMemo = Object.values(memoTerms).filter(v => v.includes(t)).length
  console.log(`  ${t.padEnd(7, '　')}  A ${cell('A 単体')}  B ${cell('B 見解1件')}  C ${cell('C 見解2件')}   副体メモ ${inMemo}/${N}`)
}

// 統合が効いたかの直接指標。副体メモにあり、単体には無く、統合側に現れた観点。
// 逆向き（単体にあって統合側に無い）も出す。これが雑音の下限になる
if (ARMS.includes('A') && (ARMS.includes('B') || ARMS.includes('C'))) {
  console.log(`\n副体メモから主体へ移った観点（C∖A かつ メモに有る） / 逆向き（A∖C）`)
  let inN = 0, outN = 0
  for (let run = 1; run <= N; run++) {
    const a = rows.find(x => x.run === run && x.arm === 'A 単体')?.terms ?? []
    const c = rows.find(x => x.run === run && x.arm === 'C 見解2件')?.terms ?? []
    const moved = c.filter(t => !a.includes(t) && (memoTerms[run] ?? []).includes(t))
    const lost  = a.filter(t => !c.includes(t))
    inN += moved.length; outN += lost.length
    console.log(`  run ${run}  移入 ${moved.join('・') || '—'}   逸失 ${lost.join('・') || '—'}`)
  }
  console.log(`  平均  移入 ${(inN / N).toFixed(1)} 観点 / 逸失 ${(outN / N).toFixed(1)} 観点`)
}
