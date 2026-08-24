import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL      as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      flowType: 'pkce',
      // AuthCallback.vue が exchangeCodeForSession() で ?code= を手動交換する。
      // デフォルト(true)のままだとSDK自身も同じcodeを自動検出して交換しにいき、
      // 早い者勝ちで負けた側がAuthPKCECodeVerifierMissingErrorになる
      detectSessionInUrl: false,
    },
})
