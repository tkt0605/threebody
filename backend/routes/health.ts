import { Router } from 'express'
import { sharedApiKey } from '../sharedKey'
import { hasSupabaseAdminConfig } from '../supabaseAdmin'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    providers: ['anthropic', 'openai', 'deepseek', 'ollama'],
    // 環境変数が入っているかどうかだけを返す（キーそのものは返さない）。
    // Renderに設定が届いているかを、ログを見ずに外から確認できるようにする
    config: {
      sharedKey:      sharedApiKey() !== null,
      anthropicModel: Boolean(process.env.ANTHROPIC_MODEL_FAST),
      supabase:       hasSupabaseAdminConfig(),
    },
  })
})

export default router
