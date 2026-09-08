import { createClient } from '@supabase/supabase-js'

const supabaseUrl            = import.meta.env.VITE_SUPABASE_URL             as string
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!supabasePublishableKey?.startsWith('sb_publishable_')) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY には sb_publishable_ 形式のキーが必要です')
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      flowType: 'pkce',
      // AuthCallback.vue が exchangeCodeForSession() で ?code= を手動交換する。
      // デフォルト(true)のままだとSDK自身も同じcodeを自動検出して交換しにいき、
      // 早い者勝ちで負けた側がAuthPKCECodeVerifierMissingErrorになる
      detectSessionInUrl: false,
    },
})
