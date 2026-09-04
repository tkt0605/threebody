import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { notifyStart, notifyEnd, waitForRelease, resetSpeechHandoff } from '../../lib/speechHandoff'

describe('speechHandoff', () => {
  beforeEach(() => {
    resetSpeechHandoff()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('誰も掴んでいなければ待たずに返る（初回の遅延をゼロにする）', async () => {
    let resolved = false
    void waitForRelease().then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('掴んでいる認識器が手放すまで待つ', async () => {
    notifyStart()

    let resolved = false
    void waitForRelease().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(false)

    notifyEnd()
    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(true)
  })

  it('onend が来ないまま終わった認識器で永久に待たされない', async () => {
    notifyStart()

    let resolved = false
    void waitForRelease().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(resolved).toBe(true)
  })

  it('2つ掴んでいるなら両方が手放すまで待つ', async () => {
    notifyStart()
    notifyStart()

    let resolved = false
    void waitForRelease().then(() => { resolved = true })

    notifyEnd()
    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(false)

    notifyEnd()
    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(true)
  })

  it('待っている側が複数いても全員が起きる', async () => {
    notifyStart()

    const woke: number[] = []
    void waitForRelease().then(() => woke.push(1))
    void waitForRelease().then(() => woke.push(2))

    notifyEnd()
    await vi.advanceTimersByTimeAsync(500)
    expect(woke).toEqual([1, 2])
  })
})
