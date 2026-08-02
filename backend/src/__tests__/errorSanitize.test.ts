import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { collectSecrets, sanitizeErrorMessage } from '../errorSanitize'

const SHARED = 'sk-ant-shared-operator-key-0123456789'
const USER   = 'sk-user-own-key-abcdefghijklmnop'

describe('collectSecrets', () => {
  const saved = process.env.SHARED_ANTHROPIC_API_KEY

  beforeEach(() => { process.env.SHARED_ANTHROPIC_API_KEY = SHARED })
  afterEach(() => {
    if (saved === undefined) delete process.env.SHARED_ANTHROPIC_API_KEY
    else process.env.SHARED_ANTHROPIC_API_KEY = saved
  })

  it('共有キーとリクエスト由来のキーを両方集める', () => {
    const secrets = collectSecrets({
      bodies: [{ apiKey: USER }, { apiKey: '' }],
      apiKey: USER,
    })
    expect(secrets).toContain(SHARED)
    expect(secrets).toContain(USER)
  })

  it('空文字・空白のみ・undefined は落とす', () => {
    // 空文字を秘匿値として扱うと、あらゆる文字列が丸ごと伏せ字になる
    const secrets = collectSecrets({ bodies: [{ apiKey: '' }, { apiKey: '   ' }, {}] })
    expect(secrets.every(s => s.trim().length > 0)).toBe(true)
  })

  it('引数なしでも共有キーだけは集める', () => {
    expect(collectSecrets()).toContain(SHARED)
  })
})

describe('sanitizeErrorMessage', () => {
  it('エコーバックされた共有キーを伏せ、診断に要る文脈は残す', () => {
    const err = new Error(
      `401 {"error":{"message":"Invalid API key: ${SHARED}","type":"authentication_error"}}`,
    )
    const out = sanitizeErrorMessage(err, [SHARED])

    expect(out).not.toContain(SHARED)
    expect(out).toContain('401')
    expect(out).toContain('authentication_error')
  })

  it('渡し損ねたキーもパターン照合で拾う', () => {
    // 手元に無いキー（バックエンドの環境変数側のキーがエラー本文に混ざった等）が
    // 素通りしないことを確認する。secrets は空で渡す
    const stray = 'sk-ant-api03-NOTINTHELIST-abcdefghijklmnop'
    const out   = sanitizeErrorMessage(new Error(`403 forbidden: ${stray}`), [])

    expect(out).not.toContain(stray)
    expect(out).toContain('403')
  })

  it('Error でない値も文字列化して通す', () => {
    expect(sanitizeErrorMessage('plain failure', [])).toBe('plain failure')
    expect(sanitizeErrorMessage({ code: 500 }, [])).toContain('object')
  })

  it('秘匿値を含まないメッセージは変えない', () => {
    const msg = 'Ollama request failed: 500 Internal Server Error'
    expect(sanitizeErrorMessage(new Error(msg), [SHARED])).toBe(msg)
  })
})
