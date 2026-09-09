#!/usr/bin/env node
// anon に見せない列が、本番DBでも拒否されることを実プロジェクトで確認する。
// 行ポリシーが正しくても、列の SELECT 権限は独立して検証する必要がある。
//
// 200 + [] を「読めないから安全」と読んではいけない。
// 列が revoke されていれば PostgREST は 4xx を返す。200 は列が見えていることを意味する。

import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const url = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const checks = [
  ['shared_messages.user_id', 'shared_messages?select=user_id&limit=1'],
  ['messages.signals', 'messages?select=signals&limit=1'],
]

if (!url || !publishableKey) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が .env に必要です。')
  process.exit(1)
}

let failed = false
for (const [name, path] of checks) {
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: publishableKey },
    })
    const ok = response.status >= 400
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — status=${response.status}`)
    failed ||= !ok
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAIL  ${name}  — 接続失敗: ${message}`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
