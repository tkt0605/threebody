import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useSettings } from './useSettings'
import { containsSecret, redactDeep } from '../lib/redact'

import type {ErrorReportContext} from '../types/message'

export function useFeedback() {
    async function reportError(ctx: ErrorReportContext): Promise<void>{
        const {user} = useAuth()
        const {settings} = useSettings()
        if (!user.value) throw new Error('ログインしていません')
        
        const secrets = settings.bodies.map(b => b.apiKey)
    
        const payload = redactDeep({
            user_id: user.value.id,
            conversation_id: ctx.conversationId,
            kind: 'error_report' as const,
            comment: null,
            error_raw: ctx.raw,
            error_display: ctx.display,
            context: {
                thinkingLevel: ctx.thinkingLevel,
                providers: ctx.providers,
                userAgent: ctx.userAgent,
                occurredAt: ctx.occurredAt
            },
        }, secrets)
        if (containsSecret(payload, secrets)){
            throw new Error('秘匿値の混入を検出したため送信を中止しました')
        }
        const { error } = await supabase.from('feedback').insert(payload)
        if (error) throw error;
    }

    return { reportError }
}