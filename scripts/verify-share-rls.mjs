#!/usr/bin/env node
// 共有のRLSとDBトリガーを、実プロジェクトに対して確かめる。
//
// 【境界】
// authenticated の所有者は shared_messages に管理行を作り、DBトリガーが公開してよい
// 内容だけを published_turns へ複製する。anon は published_turns だけを読む。
// shared_messages / messages / content_blocks は、共有中かどうかに関係なくanonへ開けない。
//
// 【何を確かめるか】
//   1. 旧3テーブルはanonから拒否される
//   2. 管理行を作ると、同じtoken・内容の公開スナップショットをanonで読める
//   3. 公開テーブルにも内部ID・所有者・操作記録・revoked_atを公開しない
//   4. 管理行を取り消すと、DBトリガー経由で公開スナップショットも読めなくなる
//
// 【使い方】読み書きの両方を使うので、自分のアカウントのアクセストークンが要る。
// アクセストークンは約1時間で失効するため.envへ保存せず、実行時だけ環境変数へ渡す。
//   read -s "THREEBODY_TOKEN?Supabase access token: "; export THREEBODY_TOKEN; echo
//   node scripts/verify-share-rls.mjs; unset THREEBODY_TOKEN
//
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY は.envから読む。
// 検証で作った管理行は削除せず、finallyで必ず取り消す。

import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const URL_BASE        = process.env.VITE_SUPABASE_URL
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const TOKEN           = process.env.THREEBODY_TOKEN

if (!URL_BASE || !PUBLISHABLE_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が .env にありません。')
  process.exit(1)
}
if (!TOKEN) {
  console.error('THREEBODY_TOKEN が要ります（devtools の localStorage sb-*-auth-token → access_token）。')
  process.exit(1)
}

function tokenClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  } catch {
    return null
  }
}

// publishable keyをユーザーのトークンと取り違えると、owner側までanonで走り、
// RLSの200 + []を検証成功と誤認する。リクエスト前に主体と有効期限を固定する。
const claims = tokenClaims(TOKEN)
if (claims?.role !== 'authenticated' || typeof claims.sub !== 'string') {
  console.error(`THREEBODY_TOKEN がユーザーのアクセストークンではありません（role=${claims?.role ?? 'unknown'}）。`)
  process.exit(1)
}
if (typeof claims.exp === 'number' && claims.exp <= Math.floor(Date.now() / 1000)) {
  console.error('THREEBODY_TOKEN の有効期限が切れています。ブラウザから新しいaccess_tokenを取得してください。')
  process.exit(1)
}

// as は「誰として叩くか」。anon = 未ログインの閲覧者、owner = 自分。
async function rest(as, path, init = {}) {
  const authorization = as === 'owner' ? { Authorization: `Bearer ${TOKEN}` } : {}
  const response = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...authorization,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  return { status: response.status, body }
}

function rowsOf(response) {
  return Array.isArray(response.body) ? response.body : []
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])
    )
  }
  return value
}

const results = []
function check(name, ok, note = '') {
  results.push({ name, ok, note })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`)
}

// 旧経路は行が0件だから安全なのではなく、権限そのものが無い4xxを合格とする。
for (const [name, path] of [
  ['旧経路 shared_messages はanonから読めない', 'shared_messages?select=token&limit=1'],
  ['旧経路 messages はanonから読めない', 'messages?select=id&limit=1'],
  ['旧経路 content_blocks はanonから読めない', 'content_blocks?select=id&limit=1'],
]) {
  const response = await rest('anon', path)
  check(name, response.status >= 400, `status=${response.status}`)
}

// 生きている共有が無い直近の主体回答を使う。同じターンにURLを2つ作らず、既存共有も
// 取り消さないため、候補が無ければ先に新しい会話を1往復してもらう。
const [recent, activeShares] = await Promise.all([
  rest('owner', 'messages?select=id,content,conversation_id,timestamp&role=eq.assistant&order=timestamp.desc&limit=50'),
  rest('owner', 'shared_messages?select=message_id&revoked_at=is.null'),
])
if (recent.status !== 200 || activeShares.status !== 200) {
  console.error('検証対象を取得できませんでした。トークンまたは所有者用RLSを確認してください。', {
    messages: recent.status,
    sharedMessages: activeShares.status,
  })
  process.exit(1)
}

const activeMessageIds = new Set(rowsOf(activeShares).map(row => row.message_id))
const answer = rowsOf(recent).find(row => !activeMessageIds.has(row.id))
if (!answer) {
  console.error('未共有の主体回答が見つかりません。新しい会話を1往復してから再実行してください。')
  process.exit(1)
}

const questionResponse = await rest(
  'owner',
  `messages?select=id,content&conversation_id=eq.${answer.conversation_id}&role=eq.user&timestamp=lt.${encodeURIComponent(answer.timestamp)}&order=timestamp.desc&limit=1`
)
if (questionResponse.status !== 200) {
  console.error('主体回答に対応する問いを取得できませんでした。', { status: questionResponse.status })
  process.exit(1)
}
const question = rowsOf(questionResponse)[0] ?? null

const [me, blockResponse] = await Promise.all([
  rest('owner', 'user_setting?select=id&limit=1'),
  rest('owner', `content_blocks?select=type,payload,sort_order&message_id=eq.${answer.id}&order=sort_order.asc`),
])
const userId = rowsOf(me)[0]?.id
if (!userId || blockResponse.status !== 200) {
  console.error('所有者または検算データを取得できませんでした。', {
    userSetting: me.status,
    contentBlocks: blockResponse.status,
  })
  process.exit(1)
}

const missingToken = randomUUID()
const beforeShare = await rest('anon', `published_turns?select=token&token=eq.${missingToken}`)
check('存在しないtokenでは公開スナップショットを読めない',
  beforeShare.status === 200 && rowsOf(beforeShare).length === 0,
  `status=${beforeShare.status} rows=${rowsOf(beforeShare).length}`)

const created = await rest('owner', 'shared_messages', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    message_id:          answer.id,
    question_message_id: question?.id ?? null,
    user_id:             userId,
  }),
})
const token = rowsOf(created)[0]?.token
if (!token) {
  console.error('共有を作れませんでした。同期トリガーと所有者用RLSを確認してください。', {
    status: created.status,
    body: created.body,
  })
  process.exit(1)
}
console.log('\n検証用の共有を作成しました。\n')

let revoked = false
try {
  const published = await rest(
    'anon',
    `published_turns?select=token,question,answer,content_blocks,created_at&token=eq.${token}`
  )
  const snapshot = rowsOf(published)[0]
  check('管理行と同じtokenの公開スナップショットをanonで読める',
    published.status === 200 && rowsOf(published).length === 1,
    `status=${published.status} rows=${rowsOf(published).length}`)
  check('問いと主体の答えが公開スナップショットへ一致する',
    snapshot?.question === (question?.content ?? null) && snapshot?.answer === answer.content)
  check('検算カードが公開スナップショットへ一致する',
    JSON.stringify(canonical(snapshot?.content_blocks ?? []))
      === JSON.stringify(canonical(rowsOf(blockResponse))))

  // revoked_atはRLSの判定には使うが表示列ではない。内部ID等は列自体を持たない。
  const hidden = await rest('anon', `published_turns?select=revoked_at&token=eq.${token}`)
  check('公開スナップショットの取消状態はanonから読めない', hidden.status >= 400,
    `status=${hidden.status}`)

  const revokeResponse = await rest('owner', `shared_messages?token=eq.${token}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  })
  revoked = revokeResponse.status === 200 && rowsOf(revokeResponse).length === 1
  check('所有者が管理台帳から共有を取り消せる', revoked, `status=${revokeResponse.status}`)
} finally {
  if (!revoked) {
    await rest('owner', `shared_messages?token=eq.${token}`, {
      method: 'PATCH',
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    })
  }
}

const afterRevoke = await rest('anon', `published_turns?select=token&token=eq.${token}`)
check('取り消すと公開スナップショットをanonから読めなくなる',
  afterRevoke.status === 200 && rowsOf(afterRevoke).length === 0,
  `status=${afterRevoke.status} rows=${rowsOf(afterRevoke).length}`)

const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length === 0 ? 0 : 1)
