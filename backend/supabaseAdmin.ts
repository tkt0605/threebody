// secret key で動くサーバー専用の Supabase クライアント。
//
// secret key は service_role として動き、RLS も列GRANTも両方バイパスする。共有キーの割当列
// （can_use_shared_key / shared_daily_count / shared_last_used_date）は
// docs/shared-key-migration.sql で authenticated から書き込み権限を取り上げてあるため、
// これらを更新できるのはこのクライアントだけになる。
//
// このモジュールは backend/ 配下からのみ import すること。フロント側に渡ると
// 全ユーザーのデータを読み書きできる鍵を配ることになる。
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 初回呼び出し時に組み立てる（モジュール読み込み時ではなく）。
// ESM の import は server.ts の本体より先に評価されるため、トップレベルで
// process.env を読むと dotenv.config() の前になり必ず undefined になる。
// undefined = 未初期化、null = 環境変数が無く利用不可、の3状態で持つ
let cached: SupabaseClient | null | undefined

export function hasSupabaseAdminConfig(): boolean {
  return Boolean(
    process.env.VITE_SUPABASE_URL
    && process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'),
  )
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached

  // URL はフロントと同じ公開エンドポイントを使う。VITE_ 接頭辞付きの1本に
  // 揃えることで、同じ値を .env に二重管理しない。
  const url       = process.env.VITE_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  // 環境変数が無い環境（Supabaseを設定していないローカル等）では null を返す。
  // ここで throw するとサーバーが起動しなくなり、共有キーと無関係な
  // 従来のBYOKユーザーまで巻き添えで止まる
  if (!url || !secretKey?.startsWith('sb_secret_')) {
    console.warn('[supabaseAdmin] VITE_SUPABASE_URL または sb_secret_ 形式の SUPABASE_SECRET_KEY が未設定のため共有キー機能は無効です')
    cached = null
    return cached
  }

  cached = createClient(url, secretKey, {
    auth: {
      // サーバーではユーザーセッションを持たない。
      // 既定のままだとトークンの永続化・自動更新を試みて無駄な状態を抱える
      persistSession:   false,
      autoRefreshToken: false,
    },
  })
  return cached
}
