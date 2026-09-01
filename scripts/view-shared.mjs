#!/usr/bin/env node
// 見解の共有（ROADMAP ③）と検算（②）、write済み・read未実装の2つの数値を集計する。
//
// 【なぜ2つを1本にまとめるか】
// どちらも「write だけ実装済みで read が無い」という同型の穴（docs/schema.sql 章1）。
// ①は conversations.shared_from × shared_messages、②は content_blocks.payload の
// hasFinding × 検算対象ターン数。集計元のテーブルは別だが、穴の形が同じなので
// 同じタイミングで着手する。
//
// 【なぜ anon key ではなく service key か】
// 集計はユーザーをまたぐ全件が対象。conversations / content_blocks の RLS は
// auth.uid() = user_id（または conversations 経由）でしか通さないため、anon key + 1人分の
// トークンでは自分のぶんしか見えない。verify-share-rls.mjs とは逆に、ここでは
// backend/supabaseAdmin.ts と同じ service key（RLSを完全にバイパスする）を使う。
//
// 【① 共有からの再実行率】
// conversations.shared_from は「会話作成時に一度だけ書く shared_messages.token の写し」
// （docs/schema.sql）。read側が無いので、シェアが実際に再実行を生んでいるかは
// 一度も数えられていない。分母は発行済みトークン数（shared_messages）、分子は
// shared_from が実在トークンを指している会話数。
//
// 【② 意見が割れた率】
// content_blocks.type = 'perspective' の1行が「検算に回った1ターン」
// （payload = { bodies: BodyPerspective[] }、src/composables/useChat.ts の toBlockRows）。
// bodies[].hasFinding は「その副体が指摘を出したか」（backend/llm/secondaryPrompt.ts の
// hasReviewFinding）。1体でも true なら、そのターンは主体と副体の見解が割れたとみなす。
// hasFinding はこの列を足す前に保存された行には無い（undefined＝不明、false＝指摘なし
// とは区別する。src/types/message.ts の BodyPerspective）。
//
// 【使い方】
//   node scripts/view-shared.mjs
// SUPABASE_URL / SUPABASE_SERVICE_KEY は .env から読む（backend/supabaseAdmin.ts と同じ2本）。

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const URL_BASE     = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

if (!URL_BASE || !SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY が .env にありません（backend/supabaseAdmin.ts と同じ変数）。')
  process.exit(1)
}

const supabase = createClient(URL_BASE, SERVICE_KEY)

// PostgREST は1回のGETにつき既定1000件までしか返さない。件数が伸びても取りこぼさない
// よう、range で総なめする（この規模の集計スクリプトを毎回書き直したくないため）。
async function fetchAll(table, select) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`)
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

const pct = (num, den) => (den === 0 ? 'N/A（分母0）' : `${((num / den) * 100).toFixed(1)}%`)

async function reportShareRerun() {
  console.log('\n── ① 共有からの再実行率 ──────────────────────────')

  const shares = await fetchAll('shared_messages', 'token')
  const totalShares = shares.length

  const tokenSet = new Set(shares.map(s => s.token))

  const reruns = await fetchAll('conversations', 'shared_from')
  const withSharedFrom = reruns.filter(c => c.shared_from !== null)

  const matched = withSharedFrom.filter(c => tokenSet.has(c.shared_from))
  
  const orphaned = withSharedFrom.length - matched.length
  const distinctTokensReused = new Set(matched.map(c => c.shared_from)).size

  console.log(`発行済みシェア数（shared_messages）        : ${totalShares}`)
  console.log(`shared_from が立っている会話数              : ${withSharedFrom.length}`)
  console.log(`  うち実在トークンに一致                    : ${matched.length}`)
  if (orphaned > 0) {
    console.log(`  うち一致するトークンが無い（要確認）      : ${orphaned}`)
  }
  console.log(`再実行を生んだシェアの数（ユニークトークン） : ${distinctTokensReused}`)
  console.log(`再実行率（ユニークトークン / 発行済みシェア）: ${pct(distinctTokensReused, totalShares)}`)
  console.log(`再実行率（再実行件数 / 発行済みシェア）      : ${pct(matched.length, totalShares)}`)
}

async function reportReviewSplit() {
  console.log('\n── ② 意見が割れた率 ──────────────────────────────')

  const blocks = await fetchAll('content_blocks', 'payload').then(rows =>
    rows.filter(r => Array.isArray(r.payload?.bodies)),
  )
  const targetTurns = blocks.length

  let splitTurns = 0
  let unknownTurns = 0
  for (const { payload } of blocks) {
    const bodies = payload.bodies
    if (bodies.some(b => b.hasFinding === true)) {
      splitTurns++
    } else if (bodies.every(b => b.hasFinding === undefined)) {
      // hasFinding を足す前に保存されたターン。「割れなかった」ではなく「不明」
      unknownTurns++
    }
  }
  const knownTurns = targetTurns - unknownTurns

  console.log(`検算対象ターン数（content_blocks.type='perspective'）: ${targetTurns}`)
  if (unknownTurns > 0) {
    console.log(`  うち hasFinding が無い旧データ（不明）              : ${unknownTurns}`)
  }
  console.log(`意見が割れたターン数（hasFinding=true が1体以上）    : ${splitTurns}`)
  console.log(`割れた率（対象ターン数に対して）                    : ${pct(splitTurns, targetTurns)}`)
  if (unknownTurns > 0) {
    console.log(`割れた率（不明を除いた既知データ内）                : ${pct(splitTurns, knownTurns)}`)
  }
}

await reportShareRerun()
await reportReviewSplit()
console.log()
