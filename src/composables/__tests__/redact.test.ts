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

// 二段目（パターン照合）。一段目は実値との完全一致しか見ないため、以下は素通りしてしまう
describe('redactText（パターン照合）', () => {
    it('プロバイダー側でマスクされて変形したキーも伏せ字にする', () => {
        // OpenAIが返す実際の形。実値 sk-dummy-1234567890abcdef とは別物なので一段目では消せない
        const raw = '401 Incorrect API key provided: sk-dummy*************cdef. You can find your API key at https://platform.openai.com/account/api-keys.'
        const out = redactText(raw, ['sk-dummy-1234567890abcdef'])

        expect(out).not.toContain('sk-dummy')
        expect(out).toContain('[APP_REDACTED]')
        expect(out).toContain('401 Incorrect API key provided')
    })

    it('秘匿値が手元に無くてもキーらしき文字列を伏せ字にする', () => {
        // バックエンドの環境変数のキーや、報告前に設定から消されたキーがこれに当たる
        expect(redactText('invalid key: sk-ant-api03-XXXXXXXXXXXX')).toContain('[APP_REDACTED]')
        expect(redactText('Authorization: Bearer abcdef0123456789')).not.toContain('abcdef0123456789')
        expect(containsSecret({ error_raw: 'key sk-proj-ABCDEFGHIJKL' })).toBe(true)
    })

    it('キーを含まない通常のエラー文は壊さない', () => {
        const normal = 'ネットワークに接続できません。バックエンドが起動しているか確認してください。'
        expect(redactText(normal, [])).toBe(normal)
        expect(redactText('サーバーエラーが発生しました (HTTP 500)。')).toBe('サーバーエラーが発生しました (HTTP 500)。')
        expect(containsSecret({ providers: ['openai', 'ollama'], thinkingLevel: 3 })).toBe(false)
    })
})