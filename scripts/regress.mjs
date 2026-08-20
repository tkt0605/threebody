#!/usr/bin/env node
// プロンプト回帰ハーネス。
//
// 【なぜ要るか】
// プロンプトで挙動を縛った結果は確率的にしか現れない。1回投げて捏造が出なかったのは
// 「直った」のか「たまたま出なかった」のかを区別できず、実際に同じ質問を4回投げて
// 毎回違う失敗（捏造 → 全面辞退 → 誤った出典 → 辞退）が出た。合否の条件を出力より先に
// 固定し、同じ条件で複数回走らせて数える以外に、判定する方法が無い。
//
// 【なぜ curl ではなく node の fetch か】
// SSE のフレームを1件ずつ JSON として復号しないと、副体の出力（body_text）と主体の
// 出力（text）を分けられない。判定は主体の本文だけに当てないと意味がない（副体は
// 「崩れる点」という見出しを出すのが仕事なので、混ぜると常に不合格になる）。
// bash で JSON を1行ずつ復号するのは信頼できないため、転送も node に寄せた。
//
// 【なぜ既定が Ollama 3体か】
// 共有キー経路は 1日3回（sharedKey.ts の SHARED_DAILY_LIMIT）で、4問×5回=20回を
// 走らせられない。自前のクラウドキーはフロントの keyVault で暗号化されており平文で
// 置けない。Ollama は無料・無制限で、そもそも今デバッグしている小さいモデルの挙動が
// そこに出る。クラウドで見たいときは --provider と THREEBODY_API_KEY で差し替える。
//
// 【使い方】
//   THREEBODY_TOKEN=<Supabaseのアクセストークン> node scripts/regress.mjs
//   THREEBODY_TOKEN=... node scripts/regress.mjs --n 5 --only external-data
//
// トークンはブラウザの devtools から取る（localStorage の sb-*-auth-token の
// access_token）。認証は必須で、無いと /api/chat は 401 を返す（backend/auth.ts）。

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
  
// ── 引数 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const OPT = {
  n:        Number(arg('n', 5)),
  out:      arg('out', 'docs/chat_see.log'),
  base:     arg('base', process.env.THREEBODY_BASE_URL ?? 'http://localhost:3000'),
  level:    Number(arg('level', 3)),
  only:     arg('only', null),
  provider: arg('provider', 'ollama'),
  model:    arg('model', ''),
  // /api/chat のレートリミットは 15回 / 5分（chat.ts の chatRateLimit）。
  // 20回を連続で投げると必ず 429 に当たるので、既定を 21秒 に置いて余裕を持たせる
  delay:    Number(arg('delay', 21)),
  quiet:    has('quiet'),
}

const TOKEN = process.env.THREEBODY_TOKEN

// ── 回帰セット ────────────────────────────────────────────────────────
// 直した箇所ごとに1問。1問では、直した3箇所のうち1つしか通らない。
// turns が2件ある問いは、1件目の答えを履歴に積んでから2件目を投げる
// （CONTEXT_HEAD_CHARS 経由の履歴汚染を通すため）
const DATA_QUESTION =
  'アメリカ、中国、日本、インド、韓国、シンガポールの過去３０年におけるGDP比の教育支出額の増減についてグラフでまとめて'

const QUESTIONS = [
  {
    id:    'external-data',
    label: '外部データを求める',
    turns: [DATA_QUESTION],
    // A/D は目視。捏造かどうかは、その数値が実在するかを人が知らないと決まらない
    checks: ['E3', 'C', 'B', 'D1', 'R1', 'R2', 'R3', 'A', 'D'],
  },
  {
    id:     'greeting',
    label:  '挨拶（縮退の確認）',
    turns:  ['おはよう'],
    // 検算へ回さず単体で答えるべき場面。needsMultiBody / REVIEW_MIN_CHARS の担当
    checks: ['F', 'E3'],
  },
  {
    id:     'code',
    label:  'コードを求める',
    turns:  ['配列から重複を除く TypeScript の関数を書いて'],
    checks: ['G', 'B', 'E3', 'R1', 'R2', 'R3'],
  },
  {
    id:     'followup',
    label:  '直前の回答に「もっと詳しく」',
    turns:  [DATA_QUESTION, 'もっと詳しく'],
    // H は履歴汚染。検算方式では今ターンの答えを副体へ渡すのが仕様なので、
    // 「渡していないはずの過去ターンの本文」だけを汚染として見る
    checks: ['H', 'D1', 'E3', 'R1', 'R2', 'R3', 'A', 'D'],
  },
]

// ── 判定 ──────────────────────────────────────────────────────────────
// 【契約の改訂：統合方式 → 検算方式】
// 主体が副体を一切見なくなったため、旧 E1・E2（副体の見出し／見解ラベルが主体本文に
// 混入していないか）は構造上もう落ちない。落ちない判定を合格として数えると、
// 合格数が実力ではなく設計の副産物になる。両方とも廃止した。
//
// 旧 H（前ターンの本文が副体に流れ込んでいない）は前提そのものが食い違う。新設計は
// 意図的に今ターンの答えを副体へ渡すからだ。ただし「誤りが世代を超えて増殖する経路を
// 塞ぐ」という狙いは生きているので、測る対象を「今ターンの答えに含まれない過去本文」
// へ絞り直した（下の H）。
//
// 代わりに、検算方式でしか起きない失敗を3つ足した（R1・R2・R3）。
//
// 自動判定は、主体の本文と副体の本文を別々に当てる。混ぜると意味を失う
const CHECKS = {
  E3: {
    kind: '自動', label: '内省・自己校正の残骸が無い',
    run: ({ primary }) => {
      const m = primary.match(/この結果はどうか|Thinking Process|Analyze|Step\s*\d|読み返し|以上でよろしい|【作業】|【作業結果】/)
      return m ? { ok: false, note: `「${m[0]}」` } : { ok: true }
    },
  },
  C: {
    kind: '自動', label: '表で出している',
    run: ({ primary }) => {
      // Markdown の表は、セル行と区切り行の両方が要る
      const cell = /^\s*\|.*\|\s*$/m.test(primary)
      const rule = /^\s*\|[\s:|-]+\|\s*$/m.test(primary)
      return cell && rule ? { ok: true } : { ok: false, note: cell ? '区切り行が無い' : '表が無い' }
    },
  },
  G: {
    kind: '自動', label: 'コードブロックを出している',
    run: ({ primary }) => (primary.includes('```') ? { ok: true } : { ok: false }),
  },
  F: {
    kind: '自動', label: '検算へ回さず単体で答えた',
    // 旧 F と見ているものは同じだが、根拠が変わった。統合方式では needsMultiBody だけが
    // 門番で、通ってしまえば副体が先に走った。検算方式では答えが出てから
    // needsMultiBody と REVIEW_MIN_CHARS の両方で判定し、結果が answer_done.review に載る
    run: ({ bodies, review }) => {
      if (bodies.length > 0) return { ok: false, note: `副体 ${bodies.length}体が走った` }
      if (review === true)   return { ok: false, note: 'review:true なのに副体が走っていない' }
      return { ok: true }
    },
  },
  R1: {
    kind: '自動', label: '副体が指定の見出しで書いた',
    // 旧 E1 の置き換え。主体側では原理的に落ちなくなったので、判定対象を副体へ移した。
    // 形式を守れない体は、モデルが小さすぎて検算の役に立っていない側の証拠になる
    run: ({ bodies }) => {
      if (bodies.length === 0) return { ok: null, note: '副体なし' }
      const broken = bodies.filter(b => {
        const t = b.text.trim()
        if (/^指摘なし/.test(t)) return false          // 逃げ道は正しい出力
        return !new RegExp(`(^|\n)\\s*【?${b.name}】?\\s*[:：]`).test(t)
      })
      return broken.length === 0
        ? { ok: true }
        : { ok: false, note: `${broken.map(b => b.name).join('・')} が見出しを外した` }
    },
  },
  R2: {
    kind: '自動', label: '副体が答えを書き直していない',
    // 検算方式で新しく生まれた失敗。副体が答えを作り直すと、画面に答えが2つ並ぶ。
    // 副体は主体より小さいモデルなので、後から出た劣ったほうが最後に残る
    run: ({ bodies }) => {
      if (bodies.length === 0) return { ok: null, note: '副体なし' }
      for (const b of bodies) {
        if (b.text.includes('```')) return { ok: false, note: `${b.name} がコードを書いた` }
        const m = b.text.match(/修正版|書き直す|以下に改善|正しくは以下|改訂版/)
        if (m) return { ok: false, note: `${b.name}「${m[0]}」` }
      }
      return { ok: true }
    },
  },
  R3: {
    kind: '参考', label: '副体が答えの中身に即している',
    // 「誰でも最初に思いつく一般論」を書いていないか。答えに出てくる語が副体に
    // 1つも現れないなら、答えを読まずに問いだけから書いた疑いがある。
    // 参考どまりなのは、言い換えられていても正しい指摘はあり得るため
    run: ({ bodies, primary }) => {
      if (bodies.length === 0) return { ok: null, note: '副体なし' }
      const terms = [...new Set(primary.match(/[一-龠]{2,}|[ァ-ヴー]{3,}|[A-Za-z]{4,}/g) ?? [])]
      if (terms.length === 0) return { ok: null, note: '照合できる語が無い' }
      const detached = bodies.filter(b => !terms.some(t => b.text.includes(t)))
      return detached.length === 0
        ? { ok: true }
        : { ok: false, note: `${detached.map(b => b.name).join('・')} が答えの語を1つも使っていない` }
    },
  },
  H: {
    kind: '自動', label: '今ターンの答え以外の過去本文が副体に無い',
    // 旧 H の測り直し。検算方式では今ターンの答えを副体へ渡すのが仕様なので、
    // 「副体に主体の本文が現れる」こと自体は汚染ではない。汚染なのは、渡していない
    // はずの過去ターンの本文が現れる場合だけ（buildReviewMessages は履歴を渡さない）
    run: ({ bodies, primary, prevPrimary }) => {
      if (!prevPrimary) return { ok: true, note: '前ターン無し' }
      for (const b of bodies) {
        const shared = longestCommonSubstring(b.text, prevPrimary)
        if (shared.length < 20) continue
        // 今ターンの答えを経由して来たものは仕様どおり。答えに無いものだけが汚染
        if (primary.includes(shared)) continue
        return { ok: false, note: `逐語一致${shared.length}字「${shared.slice(0, 30)}」` }
      }
      return { ok: true }
    },
  },
  B: {
    kind: '参考', label: '辞退していない',
    run: ({ primary }) => {
      const excuse = primary.match(/できません|できないん|出せません|生成することができ|難しいです/)
      // 断りの文言があっても、実体を出したうえで最後に添えているなら合格。
      // 「短い」かつ「断っている」の組み合わせだけを疑いとして挙げる
      if (excuse && primary.length < 400) return { ok: false, note: `「${excuse[0]}」+ 本文${primary.length}字` }
      return { ok: true }
    },
  },
  D1: {
    kind: '自動', label: '出典をぼかしていない',
    // D の失敗のうち、run 3 で観測した形（出典を推測で埋める）はここで機械的に落とせる。
    // 「おそらく〜という名前で検索するとよいでしょう」は、出典ではなく出典の推測である
    run: ({ primary }) => {
      const m = primary.match(/おそらく|だと思われ|かと思われ|といった.{0,12}(名|コード)|などの[^。]{0,10}(データベース|統計資料|機関)/)
      return m ? { ok: false, note: `「${m[0]}」` } : { ok: true }
    },
  },
  A: { kind: '目視', label: '捏造ゼロ（数値・傾向・指標コード）', run: () => ({ ok: null }) },
  D: { kind: '目視', label: '出典が対象を実際に含む',              run: () => ({ ok: null }) },
}

function longestCommonSubstring(a, b) {
  if (!a || !b) return ''
  // 判定に要るのは「20字以上の一致があるか」だけなので、a の各20字窓を b から探す
  for (let len = Math.min(60, a.length); len >= 20; len -= 4) {
    for (let i = 0; i + len <= a.length; i++) {
      const w = a.slice(i, i + len)
      if (b.includes(w)) return w
    }
  }
  return ''
}

// ── SSE ───────────────────────────────────────────────────────────────
// イベント名は backend/llm/textService.ts が送る側の権威。
// answer_start → text → answer_done（review 付き）→ body_start / body_text / body_done
//
// 検算方式では主体の本文が先に完成し、副体はその後に続く。順序が反転したので、
// primary を読み終えてから bodies が埋まる
async function ask(messages) {
  const bodies = [
    { provider: OPT.provider, model: OPT.model, apiKey: process.env.THREEBODY_API_KEY ?? '' },
    { provider: OPT.provider, model: OPT.model, apiKey: process.env.THREEBODY_API_KEY ?? '', role: 'skeptic' },
    { provider: OPT.provider, model: OPT.model, apiKey: process.env.THREEBODY_API_KEY ?? '', role: 'realist' },
  ]

  const res = await fetch(`${OPT.base}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      messages,
      thinkingLevel: OPT.level,
      // 人格はフロントが組むが、ハーネスは既定値（chat.ts の systemPrompt の既定）に
      // 任せる。ここで文面を作ると、測っている対象がフロントの人格ではなくなる
      provider:     OPT.provider,
      bodies,
      model:        OPT.model,
      apiKey:       process.env.THREEBODY_API_KEY ?? '',
      // 自前 bodies で走らせる。共有キーは1日3回で回帰に使えない
      useSharedKey: false,
    }),
  })

  if (res.status === 429) throw new Error('429 レートリミット。--delay を増やしてください')
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`)

  const bodyTexts = new Map()   // bodyIndex → { name, provider, text }
  let primary = ''
  let error   = null
  // answer_done が伝える「このターンは検算に回すか」。F の判定に使う
  let review  = null

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue
      let ev
      try { ev = JSON.parse(payload) } catch { continue }

      if (ev.type === 'body_start') bodyTexts.set(ev.bodyIndex, { name: ev.name, provider: ev.provider, text: '' })
      else if (ev.type === 'body_text') {
        const b = bodyTexts.get(ev.bodyIndex)
        if (b) b.text += ev.content
      }
      else if (ev.type === 'text')        primary += ev.content
      else if (ev.type === 'answer_done') review = ev.review ?? false
      else if (ev.type === 'error')       error = ev.message ?? ev.code
    }
  }

  // answer_start は主体の bodyIndex を伝えるだけで body_start を経ない。
  // 副体として数えるのは body_start が来たものだけ
  return { primary, bodies: [...bodyTexts.values()], error, review }
}

// 判定だけを外から読めるようにする。判定式そのものが回帰の対象で、
// これを直したときに壊れていないかは backend/tests/regressChecks.test.ts が見る
export { CHECKS, QUESTIONS, longestCommonSubstring }

// ── 実行 ──────────────────────────────────────────────────────────────
// import されたときは走らせない（上の判定だけを取り出せるようにするため）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {

if (!TOKEN) {
  console.error('THREEBODY_TOKEN が未設定です。Supabase のアクセストークンを渡してください。')
  console.error('例: THREEBODY_TOKEN=eyJ... node scripts/regress.mjs')
  process.exit(1)
}

const commit = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim() }
  catch { return 'unknown' }
})()

mkdirSync(dirname(OPT.out), { recursive: true })
const write = (s) => {
  appendFileSync(OPT.out, `${s}\n`, 'utf-8')
  if (!OPT.quiet) console.log(s)
}

const targets = OPT.only ? QUESTIONS.filter(q => q.id === OPT.only) : QUESTIONS
if (targets.length === 0) {
  console.error(`--only ${OPT.only} に一致する問いがありません。id: ${QUESTIONS.map(q => q.id).join(', ')}`)
  process.exit(1)
}

const sleep = (sec) => new Promise(r => setTimeout(r, sec * 1000))
const tally = new Map()   // `${questionId}/${checkId}` → { pass, fail, manual }
const record = (key, ok) => {
  const t = tally.get(key) ?? { pass: 0, fail: 0, manual: 0 }
  if (ok === true) t.pass++
  else if (ok === false) t.fail++
  else t.manual++
  tally.set(key, t)
}
// 通信そのものが失敗した run は、判定の不合格として数えない。401 や 429 は
// プロンプトの出来とは無関係で、混ぜると「直したのに落ちた」と読み違える
const errored = new Map()   // questionId → 回数

write('')
write('='.repeat(78))
write(`回帰実行  ${new Date().toISOString()}`)
write(`条件: commit=${commit} base=${OPT.base} level=${OPT.level} bodies=${OPT.provider}×3${OPT.model ? `(${OPT.model})` : '(既定モデル)'} n=${OPT.n}`)
write(`対象: ${targets.map(q => q.id).join(', ')}`)
write('='.repeat(78))

let requestCount = 0

for (const q of targets) {
  for (let run = 1; run <= OPT.n; run++) {
    let messages = []
    let prevPrimary = null
    let result = null

    try {
      // turns が複数ある問いは、前の答えを履歴に積んでから次を投げる。
      // 会話は毎 run で作り直す（履歴を持ち越すと、前 run の誤りが次 run に流れる）
      for (const [i, turn] of q.turns.entries()) {
        // 1リクエストごとに必ず間を置く。/api/chat は 15回/5分 で弾かれる
        if (requestCount > 0) await sleep(OPT.delay)
        requestCount++
        messages = [...messages, { role: 'user', content: turn }]
        const r = await ask(messages)
        if (i < q.turns.length - 1) {
          prevPrimary = r.primary
          messages = [...messages, { role: 'assistant', content: r.primary }]
        }
        result = r
      }
    } catch (e) {
      write('')
      write('─'.repeat(78))
      write(`[${q.id} run ${run}/${OPT.n}] リクエスト失敗（判定には数えない）: ${e.message}`)
      errored.set(q.id, (errored.get(q.id) ?? 0) + 1)
      continue
    }

    const { primary, bodies, error, review } = result

    write('')
    write('─'.repeat(78))
    write(`[${q.id} run ${run}/${OPT.n}] ${q.label}   ${new Date().toISOString()}`)
    if (error) write(`!! error イベント: ${error}`)

    write(`── 副体 ${bodies.length}体（answer_done.review=${review}）──`)
    for (const b of bodies) write(`#${b.name}（${b.provider}）${b.text.length}字\n${b.text.trim() || '（空）'}`)
    write(`── 主体 ${primary.length}字 ──`)
    write(primary.trim() || '（空）')

    write('── 判定 ──')
    for (const id of q.checks) {
      const c = CHECKS[id]
      const { ok, note } = c.run({ primary, bodies, prevPrimary, review })
      record(`${q.id}/${id}`, ok)
      const verdict = ok === true ? '合格' : ok === false ? '不合格' : '?'
      write(`${c.kind}  ${id.padEnd(3)} ${c.label.padEnd(34, '　')} ${verdict}${note ? `: ${note}` : ''}`)
    }
  }
}

// ── 集計 ──────────────────────────────────────────────────────────────
// n回すべて合格でなければ合格としない。失敗が0回でも、否定できる失敗率の上限は
// おおよそ 3/n（n=5 なら 60% 以下と言えるだけ）。20マス全部が n/n でようやく足切り通過
write('')
write('='.repeat(78))
write(`集計  n=${OPT.n}  commit=${commit}`)
write('='.repeat(78))
for (const q of targets) {
  const err   = errored.get(q.id) ?? 0
  const valid = OPT.n - err
  write(`[${q.id}] ${q.label}${err ? `   ※ ${err}/${OPT.n} 回はリクエストが失敗（判定対象は ${valid} 回）` : ''}`)
  if (valid === 0) { write('  判定できる run が1回もありません。'); continue }
  for (const id of q.checks) {
    const t = tally.get(`${q.id}/${id}`) ?? { pass: 0, fail: 0, manual: 0 }
    const c = CHECKS[id]
    if (c.kind === '目視') { write(`  ${id.padEnd(3)} ${c.label} … 目視 ${t.manual}件（上の本文を読んで数える）`); continue }
    const verdict = t.fail === 0 ? `合格 ${t.pass}/${valid}` : `不合格 ${t.fail}/${valid}回で落ちた`
    write(`  ${id.padEnd(3)} ${c.label} … ${verdict}`)
  }
}
write('')
write(`※ 失敗0回でも、否定できる失敗率の上限は約 3/n（n=${OPT.n} → ${Math.min(100, Math.round(300 / OPT.n))}% 以下）。`)
write('※ 「直った」と言うには n=20 が要る。n=5 は「明らかに壊れているか」の足切り。')
write('※ A・D は自動化できない。上の本文を読んで数えること。')
write('※ 旧 E1・E2 は廃止。主体が副体を見なくなり、構造上落ちなくなったため。')
write('※ 「?」は判定対象が存在しなかった run（副体が走らなかった等）。合否には数えない。')
write(`書き出し: ${OPT.out}`)

}
