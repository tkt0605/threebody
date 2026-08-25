import { describe, expect, it } from 'vitest'
import { orphanReason } from '../../lib/orphanReason'
import type { Message } from '../../types/message'

function user(id: string, text = 'こんにちは'): Message {
  return { id, role: 'user', blocks: [{ type: 'text', content: text }], timestamp: new Date(), modality: 'text' }
}

function assistant(
  id: string,
  opts: { content?: string; interrupted?: boolean } = {},
): Message {
  return {
    id,
    role: 'assistant',
    blocks: opts.content ? [{ type: 'text', content: opts.content }] : [],
    timestamp: new Date(),
    modality: 'text',
    ...(opts.interrupted !== undefined ? { signals: { interrupted: opts.interrupted, rephrased: 0 } } : {}),
  }
}

describe('orphanReason', () => {
  it('assistant以外の役割には孤立判定をしない', () => {
    const msgs = [user('u1'), assistant('a1', { content: '答え' })]
    expect(orphanReason(msgs[1]!, msgs)).toBeNull()
  })

  it('中身のある完了済み応答が続く場合は孤立ではない', () => {
    const msgs = [user('u1'), assistant('a1', { content: '答え' })]
    expect(orphanReason(msgs[0]!, msgs)).toBeNull()
  })

  it('応答の器が無ければ lost', () => {
    const msgs = [user('u1')]
    expect(orphanReason(msgs[0]!, msgs)).toBe('lost')
  })

  it('次がuserなら（応答が無いまま次の発話が来た）lost', () => {
    const msgs = [user('u1'), user('u2')]
    expect(orphanReason(msgs[0]!, msgs)).toBe('lost')
  })

  it('器はあるが中身が無く、中断でもない場合は lost（保存前に失われた）', () => {
    const msgs = [user('u1'), assistant('a1')]
    expect(orphanReason(msgs[0]!, msgs)).toBe('lost')
  })

  it('一文字も書かれないうちに止めた場合は stopped-empty', () => {
    const msgs = [user('u1'), assistant('a1', { interrupted: true })]
    expect(orphanReason(msgs[0]!, msgs)).toBe('stopped-empty')
  })

  it('途中まで書かれてから止めた場合は stopped-partial', () => {
    const msgs = [user('u1'), assistant('a1', { content: '途中まで', interrupted: true })]
    expect(orphanReason(msgs[0]!, msgs)).toBe('stopped-partial')
  })
})
