#!/usr/bin/env node
// 共有のRLSを、実プロジェクトに対して確かめる。
//
// 【なぜ要るか】
// 共有（ROADMAP ③）は、このアプリで初めて RLS を anon へ開ける変更になる。
// ポリシーが1本でも広すぎると、共有していない会話が匿名で読めてしまう。
// これは vitest では捕まえられない — Postgres の中で起きることだからで、
// src/composables/__tests__/useSharedTurn.test.ts が見ているのはクライアント側の経路と、
// 偽supabaseで再現したポリシーの条件だけ。本物のポリシーはここで見る。
//
// 【何を確かめるか】両方向を見る。片方だけでは意味が無い
//   1. 共有したターンは anon で読める（開きすぎと閉じすぎを取り違えない）
//   2. 共有していないメッセージのIDを直接叩くと0件（完了判定そのもの）
//   3. 取り消した共有は読めない
//   4. 誰が共有したか（user_id）は anon から読めない
//
// 【使い方】読み書きの両方を使うので、自分のアカウントのトークンが要る
//   THREEBODY_TOKEN=<Supabaseのアクセストークン> node scripts/verify-share-rls.mjs
//
// トークンはブラウザの devtools から取る（localStorage の sb-*-auth-token の
// access_token）。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY は .env から読む。
//
// 【後片付け】検証で作った共有は最後に必ず取り消す（revoked_at を立てる）。
// 途中で落ちた場合は、その回で作った token が標準出力に出ているので手で消すこと。

import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const URL_BASE = process.env.VITE_SUPABASE_URL
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const TOKEN    = process.env.THREEBODY_TOKEN

if (!URL_BASE || !ANON_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が .env にありません。')
  process.exit(1)
}
if (!TOKEN) {
  console.error('THREEBODY_TOKEN が要ります（devtools の localStorage sb-*-auth-token → access_token）。')
  process.exit(1)
}

// as は「誰として叩くか」。anon = 未ログインの閲覧者、owner = 自分
async function rest(as, path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        ANON_KEY,
      Authorization: `Bearer ${as === 'owner' ? TOKEN : ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const results = []
const check = (name, ok, note = '') => {
  results.push({ name, ok, note })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`)
}

// 検証に使うターンを1つ選ぶ。自分の一番新しい assistant メッセージと、その直前の問い
const recent = await rest('owner', 'messages?select=id,role,conversation_id,timestamp&order=timestamp.desc&limit=20')
if (recent.status !== 200 || !Array.isArray(recent.body) || recent.body.length === 0) {
  console.error('自分のメッセージを取得できませんでした。トークンが古い可能性があります。', recent)
  process.exit(1)
}
const answer   = recent.body.find(m => m.role === 'assistant')
const question = recent.body.find(m => m.role === 'user' && m.conversation_id === answer?.conversation_id)
if (!answer) {
  console.error('assistant のメッセージが1件も見つかりません。先に会話を1つ作ってください。')
  process.exit(1)
}

// 共有する前に、まず「読めないこと」を確かめる。ここが通らないなら、
// 以降の PASS は「共有したから読める」ではなく「元から全部読めている」を意味する
const beforeShare = await rest('anon', `messages?select=id&id=eq.${answer.id}`)
check('共有前は anon から読めない', Array.isArray(beforeShare.body) && beforeShare.body.length === 0,
  `status=${beforeShare.status} rows=${beforeShare.body?.length}`)

const me = await rest('owner', 'user_setting?select=id&limit=1')
const userId = me.body?.[0]?.id
if (!userId) {
  console.error('user_setting の自分の行が取れませんでした。', me)
  process.exit(1)
}

const created = await rest('owner', 'shared_messages', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    message_id:          answer.id,
    question_message_id: question?.id ?? null,
    user_id:             userId,
  }),
})
const token = created.body?.[0]?.token
if (!token) {
  console.error('共有を作れませんでした（本番未適用の可能性）。', created)
  process.exit(1)
}
console.log(`\n検証用の共有: token=${token}\n`)

try {
  const ledger = await rest('anon', `shared_messages?select=token,message_id,question_message_id&token=eq.${token}`)
  check('共有した行は anon から token で引ける', ledger.body?.length === 1, `status=${ledger.status}`)

  const shared = await rest('anon', `messages?select=id,content,content_blocks(type,payload,sort_order)&id=eq.${answer.id}`)
  check('共有した答えは anon から読める', shared.body?.length === 1, `status=${shared.status}`)
  check('検算カード（content_blocks）も anon から読める',
    Array.isArray(shared.body?.[0]?.content_blocks) && shared.body[0].content_blocks.length > 0)

  // 完了判定。共有していないメッセージのIDを直接叩いても読めない
  const others = recent.body.filter(m => m.id !== answer.id && m.id !== question?.id).map(m => m.id)
  if (others.length > 0) {
    const leaked = await rest('anon', `messages?select=id&id=in.(${others.join(',')})`)
    check('共有していないメッセージのIDを直接叩いても読めない', leaked.body?.length === 0,
      `試したID ${others.length}件 / 読めた ${leaked.body?.length}件`)

    const leakedBlocks = await rest('anon', `content_blocks?select=id&message_id=in.(${others.join(',')})`)
    check('共有していないメッセージの content_blocks も読めない', leakedBlocks.body?.length === 0,
      `読めた ${leakedBlocks.body?.length}件`)
  }

  const conversations = await rest('anon', 'conversations?select=id&limit=1')
  check('会話一覧は anon から読めない', conversations.body?.length === 0 || conversations.status >= 400,
    `status=${conversations.status}`)

  // 誰が共有したかは公開しない（列単位の revoke）
  const owner = await rest('anon', `shared_messages?select=user_id&token=eq.${token}`)
  check('共有者（user_id）は anon から読めない', owner.status >= 400 || owner.body?.[0]?.user_id === undefined,
    `status=${owner.status}`)
} finally {
  await rest('owner', `shared_messages?token=eq.${token}`, {
    method: 'PATCH',
    body:   JSON.stringify({ revoked_at: new Date().toISOString() }),
  })
}

// 取り消した後は閉じている
const afterRevoke = await rest('anon', `messages?select=id&id=eq.${answer.id}`)
check('取り消すと anon から読めなくなる', afterRevoke.body?.length === 0, `rows=${afterRevoke.body?.length}`)

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length === 0 ? 0 : 1)
