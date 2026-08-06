import { Router } from 'express'
import { resolveUserId } from '../auth'
import { SHARED_DAILY_LIMIT, checkSharedAllowance } from '../sharedKey'
import { ollamaEnabled } from '../llm/providers/ollama'

const router = Router()

// フロントが「あと何回、共有キーで無料利用できるか」を事前に知るためのエンドポイント。
// /api/chat を実際に叩かなくても判定できるようにし、EmptyBrainState（泣き顔ゲート）が
// 「自分のキーは無いが共有キーでまだ使える」状態を「使えない」と誤判定しないようにする
router.get('/capabilities', async (req, res) => {
  const userId    = await resolveUserId(req.headers.authorization)
  const allowance = await checkSharedAllowance(userId)

  res.json({
    sharedKey: allowance.allowed
      ? { allowed: true,  remaining: allowance.remaining, dailyLimit: SHARED_DAILY_LIMIT, reason: null }
      : { allowed: false, remaining: 0,                   dailyLimit: SHARED_DAILY_LIMIT, reason: allowance.reason },
    ollama: { enabled: ollamaEnabled() },
  })
})

export default router
