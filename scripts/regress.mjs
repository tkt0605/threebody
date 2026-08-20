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
if (!TOKEN) {
  console.error('THREEBODY_TOKEN が未設定です。Supabase のアクセストークンを渡してください。')
  console.error('例: THREEBODY_TOKEN=eyJ... node scripts/regress.mjs')
  process.exit(1)
}

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
    checks: ['E1', 'E2', 'E3', 'C', 'B', 'D1', 'A', 'D'],
  },
  {
    id:     'greeting',
    label:  '挨拶（縮退の確認）',
    turns:  ['おはよう'],
    // 副体を呼ばずに単体で答えるべき場面。needsMultiBody / SYNTHESIS_MIN_CHARS の担当
    checks: ['F', 'E1', 'E2', 'E3'],
  },
  {
    id:     'code',
    label:  'コードを求める',
    turns:  ['配列から重複を除く TypeScript の関数を書いて'],
    checks: ['G', 'B', 'E1', 'E2', 'E3'],
  },
  {
    id:     'followup',
    label:  '直前の回答に「もっと詳しく」',
    turns:  [DATA_QUESTION, 'もっと詳しく'],
    // H は履歴汚染。副体の出力に、前ターンの主体本文がそのまま現れていないか
    checks: ['H', 'D1', 'A', 'D', 'E1', 'E2', 'E3'],
  },
]

// ── 判定 ──────────────────────────────────────────────────────────────
// 自動判定は主体の本文だけに当てる。副体は見出しを出すのが仕事なので混ぜられない
const CHECKS = {
  E1: {
    kind: '自動', label: '副体の見出しが混入していない',
    run: ({ primary }) => {
      const m = primary.match(/(?:^|\n)\s*【?(崩れる点|別の見方|最初の一手|詰まる所|効く条件)】?\s*[:：]?/)
      return m ? { ok: false, note: `「${m[1]}」` } : { ok: true }
    },
  },
  E2: {
    kind: '自動', label: '見解ラベルが混入していない',
    run: ({ primary }) => {
      const m = primary.match(/の見解】|【[^】]*体（[^）]*）/)
      return m ? { ok: false, note: `「${m[0]}」` } : { ok: true }
    },
  },
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
    kind: '自動', label: '副体を呼ばずに単体で答えた',
    run: ({ bodies }) => (bodies.length === 0
      ? { ok: true }
      : { ok: false, note: `副体 ${bodies.length}体が走った` }),
  },
  H: {
    kind: '自動', label: '前ターンの本文が副体に流れ込んでいない',
    run: ({ bodies, prevPrimary }) => {
      if (!prevPrimary) return { ok: true, note: '前ターン無し' }
      for (const b of bodies) {
        const shared = longestCommonSubstring(b.text, prevPrimary)
        // 20字の逐語一致は偶然では起きない。CONTEXT_HEAD_CHARS 経由の復唱の印
        if (shared.length >= 20) return { ok: false, note: `逐語一致${shared.length}字「${shared.slice(0, 30)}」` }
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
// body_start / body_text / body_done → synthesis_start → text
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
      else if (ev.type === 'text')  primary += ev.content
      else if (ev.type === 'error') error = ev.message ?? ev.code
    }
  }

  // synthesis_start は主体の bodyIndex でも body_start を経ずに来る。
  // 副体として数えるのは body_start が来たものだけ
  return { primary, bodies: [...bodyTexts.values()], error }
}

// ── 実行 ──────────────────────────────────────────────────────────────
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

    const { primary, bodies, error } = result

    write('')
    write('─'.repeat(78))
    write(`[${q.id} run ${run}/${OPT.n}] ${q.label}   ${new Date().toISOString()}`)
    if (error) write(`!! error イベント: ${error}`)

    write(`── 副体 ${bodies.length}体 ──`)
    for (const b of bodies) write(`#${b.name}（${b.provider}）${b.text.length}字\n${b.text.trim() || '（空）'}`)
    write(`── 主体 ${primary.length}字 ──`)
    write(primary.trim() || '（空）')

    write('── 判定 ──')
    for (const id of q.checks) {
      const c = CHECKS[id]
      const { ok, note } = c.run({ primary, bodies, prevPrimary })
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
write(`書き出し: ${OPT.out}`)
