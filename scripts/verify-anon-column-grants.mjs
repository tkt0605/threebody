#!/usr/bin/env node
// 匿名共有の読み取り境界が、本番DBでも published_turns だけに閉じていることを確認する。
// 行ポリシーが残っていても、SELECT 権限を失った旧テーブルはPostgRESTが4xxで拒否する。
//
// 200 + [] を「読めないから安全」と読んではいけない。
// 閉じる対象の200は、たまたま行が0件なだけで列を読む権限自体は残っていることを意味する。

import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const url = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const checks = [
  ['旧経路 shared_messages', 'shared_messages?select=token&limit=1', 'closed'],
  ['旧経路 messages', 'messages?select=id&limit=1', 'closed'],
  ['旧経路 content_blocks', 'content_blocks?select=id&limit=1', 'closed'],
  ['公開経路 published_turns', 'published_turns?select=token,question,answer,content_blocks,created_at&limit=1', 'open'],
]

if (!url || !publishableKey) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が .env に必要です。')
  process.exit(1)
}

let failed = false
for (const [name, path, expected] of checks) {
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: publishableKey },
    })
    const ok = expected === 'closed' ? response.status >= 400 : response.status === 200
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — status=${response.status}`)
    failed ||= !ok
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAIL  ${name}  — 接続失敗: ${message}`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
