import { describe, it, expect } from 'vitest'
import { redactText, redactDeep, containsSecret } from '../../lib/redact'

const KEY = 'sk-proj-SECRET1234567890'

describe('redactText', () => {
    it('プロバイダーがエコーバックしたキーを伏せ字に置き換える', () => {
        const raw = `Ollama request failed: 401 Unauthorized - {"error":"invalid api key: ${KEY}"}`
        const out = redactText(raw, [KEY])

        expect(out).not.toContain('SECRET1234567890')
        expect(out).toContain('[APP_REDACTED]')
        //  エラーの文脈自体は残す（残らないと報告の意味がない）
        expect(out).toContain('401 Unauthorized')
    })

    it('ネストしたオブジェクトの値も伏字化する', () => {
        const payload = {
            error_raw: `invalid key: ${KEY}`,
            context: {
                provider: ['openai'],
                nested: [
                    {note: KEY}
                ]
            },
        }
        const out = redactDeep(payload, [KEY])
        expect(containsSecret(out, [KEY])).toBe(false)
        expect(out.context.provider).toEqual(['openai'])
    })

    it('空文字や短い値を秘匿値として扱わない', () => {
         // Ollama は apiKey が空。これを秘匿値にすると全文が壊れる
        expect(redactText('hello world', ['', '   ', 'abc'])).toBe('hello world')
    })

    it('一方が他方の部分文字列でも取りこぼさない', () => {
        const short = 'sk-abcdefgh'
        const long = 'sk-abcdefgh-extended-9999'
        expect(containsSecret(redactText(`${long} / ${short}`, [short, long]), [short, long])).toBe(false)
    })
})