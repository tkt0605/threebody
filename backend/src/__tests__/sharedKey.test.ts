import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { hasOwnCloudKey, sharedApiKey, checkSharedAllowance } from '../sharedKey'

const KEY = 'sk-ant-shared-operator-key-0123456789'

describe('hasOwnCloudKey', () => {
  it('クラウド系でキーとモデルが揃っていれば「設定済み」', () => {
    expect(hasOwnCloudKey({
      bodies: [{ provider: 'anthropic', apiKey: 'sk-user-key', model: 'claude-opus-5' }],
    })).toBe(true)
  })

  it('ollama だけでは「未設定」', () => {
    // server.ts の available フィルタは ollama を無条件 true にするため、
    // available.length === 0 では未設定を検出できない。ここがその代わり
    expect(hasOwnCloudKey({
      bodies: [
        { provider: 'ollama',   apiKey: '',  model: '' },
        { provider: 'openai',   apiKey: '',  model: '' },
        { provider: 'deepseek', apiKey: '',  model: '' },
      ],
    })).toBe(false)
  })

  it('キーだけ・モデルだけでは「未設定」', () => {
    // 片方だけではAPIを呼べない。呼べない設定を「設定済み」と数えると、
    // 共有キーに落ちずにそのまま失敗する
    expect(hasOwnCloudKey({ bodies: [{ provider: 'openai', apiKey: 'sk-x', model: '' }] })).toBe(false)
    expect(hasOwnCloudKey({ bodies: [{ provider: 'openai', apiKey: '', model: 'gpt-x' }] })).toBe(false)
  })

  it('空白だけの値は未設定として扱う', () => {
    expect(hasOwnCloudKey({ bodies: [{ provider: 'openai', apiKey: '  ', model: '  ' }] })).toBe(false)
  })

  it('単体モード（provider/model/apiKey 直指定）も見る', () => {
    expect(hasOwnCloudKey({ provider: 'deepseek', apiKey: 'sk-x', model: 'deepseek-chat' })).toBe(true)
    expect(hasOwnCloudKey({ provider: 'ollama',   apiKey: '',     model: 'gemma' })).toBe(false)
  })

  it('bodies も直指定も無ければ未設定', () => {
    expect(hasOwnCloudKey({})).toBe(false)
  })

  it('3体のうち1つでも揃っていれば設定済み', () => {
    expect(hasOwnCloudKey({
      bodies: [
        { provider: 'ollama', apiKey: '', model: '' },
        { provider: 'openai', apiKey: '', model: '' },
        { provider: 'anthropic', apiKey: 'sk-user', model: 'claude-sonnet-5' },
      ],
    })).toBe(true)
  })
})

describe('sharedApiKey / checkSharedAllowance', () => {
  const saved = process.env.SHARED_ANTHROPIC_API_KEY

  beforeEach(() => { process.env.SHARED_ANTHROPIC_API_KEY = KEY })
  afterEach(() => {
    if (saved === undefined) delete process.env.SHARED_ANTHROPIC_API_KEY
    else process.env.SHARED_ANTHROPIC_API_KEY = saved
    vi.restoreAllMocks()
  })

  it('環境変数から共有キーを読む', () => {
    expect(sharedApiKey()).toBe(KEY)
  })

  it('未設定・空白のみなら null', () => {
    delete process.env.SHARED_ANTHROPIC_API_KEY
    expect(sharedApiKey()).toBeNull()
    process.env.SHARED_ANTHROPIC_API_KEY = '   '
    expect(sharedApiKey()).toBeNull()
  })

  it('共有キーが無ければ DB を見ずに unavailable', async () => {
    delete process.env.SHARED_ANTHROPIC_API_KEY
    await expect(checkSharedAllowance('user-1')).resolves.toEqual({ allowed: false, reason: 'unavailable' })
  })

  it('未ログイン（userId が null）なら not_signed_in', async () => {
    // 誰の割当かを決められない。ここを許可に倒すと無認証で使い放題になる
    await expect(checkSharedAllowance(null)).resolves.toEqual({ allowed: false, reason: 'not_signed_in' })
  })
})
