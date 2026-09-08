#!/usr/bin/env node
// 無効化した旧 anon / service_role key が本当に拒否されることを実プロジェクトで確認する。
// 新しいキーが動くだけでは、旧キーが漏えい時にまだ使える状態を見落とすため。
//
// 【使い方】
// 1. .env に一時的に次の2変数を追加する（.env は Git 管理外）。
//      RETIRED_SUPABASE_ANON_KEY=<無効化した旧 anon key>
//      RETIRED_SUPABASE_SERVICE_ROLE_KEY=<無効化した旧 service_role key>
// 2. node scripts/verify-retired-supabase-keys.mjs
// 3. PASS 後は .env から上の2変数を削除する。

import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const url = process.env.VITE_SUPABASE_URL
const retiredKeys = [
  ['旧 anon key', process.env.RETIRED_SUPABASE_ANON_KEY],
  ['旧 service_role key', process.env.RETIRED_SUPABASE_SERVICE_ROLE_KEY],
]

if (!url || retiredKeys.some(([, key]) => !key)) {
  console.error('VITE_SUPABASE_URL / RETIRED_SUPABASE_ANON_KEY / RETIRED_SUPABASE_SERVICE_ROLE_KEY が .env に必要です。')
  process.exit(1)
}

let failed = false
for (const [name, key] of retiredKeys) {
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key },
    })
    const ok = response.status === 401
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — status=${response.status}`)
    failed ||= !ok
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAIL  ${name}  — 接続失敗: ${message}`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
