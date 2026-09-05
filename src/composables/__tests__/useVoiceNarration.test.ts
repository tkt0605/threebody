import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceNarration, fillerPhrase, FILLER_DELAY_MS } from '../useVoiceNarration'

// jsdom には SpeechSynthesis が無いので、喋った内容を記録するだけの偽物を差す。
// speak した時点で即座に鳴り終わったことにして、キューの消化を同期的に追えるようにする
class FakeUtterance {
  lang = ''
  voice: unknown = null
  rate = 1
  pitch = 1
  volume = 1
  onstart: (() => void) | null = null
  onend:   (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

function installFakeSpeech() {
  const spoken: string[] = []
  const cancel = vi.fn()
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', {
    speak(u: FakeUtterance) {
      spoken.push(u.text)
      u.onstart?.()
      u.onend?.()
    },
    cancel,
    getVoices: () => [],
  })
  return { spoken, cancel }
}

describe('fillerPhrase', () => {
  it('体の数がそのまま「何人で考えているか」になる', () => {
    expect(fillerPhrase(3)).toBe('三人で考えています')
    expect(fillerPhrase(2)).toBe('二人で考えています')
  })

  it('lang が英語なら文言も英語になる（声だけ変えても不自然なため）', () => {
    expect(fillerPhrase(3, 'en-US')).toBe('three people are thinking')
    expect(fillerPhrase(2, 'en-US')).toBe('two people are thinking')
  })
})

describe('useVoiceNarration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // 逐次TTS（外部レビュー #4）
  describe('逐次読み上げ', () => {
    it('文が完成するたびに読み上げ、書きかけの文は読まない', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1)

      narration.feed('こんにちは。今日は')
      expect(spoken).toEqual(['こんにちは。'])

      // 同じ文をもう一度渡しても二重に読まない
      narration.feed('こんにちは。今日は晴れ')
      expect(spoken).toEqual(['こんにちは。'])

      narration.feed('こんにちは。今日は晴れです。')
      expect(spoken).toEqual(['こんにちは。', '今日は晴れです。'])
    })

    it('句点で終わらなかった最後の断片も end で読み切る', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1)

      narration.feed('わかりました。あと少し')
      narration.end('わかりました。あと少し')

      expect(spoken).toEqual(['わかりました。', 'あと少し'])
    })

    it('読み上げが尽きたら onIdle を呼ぶ（音声ラウンドの終了）', () => {
      installFakeSpeech()
      const onIdle = vi.fn()
      const narration = useVoiceNarration(onIdle)
      narration.begin(1)

      narration.feed('途中です。')
      // まだ本文が届く途中なので「終わった」ではない
      expect(onIdle).not.toHaveBeenCalled()

      narration.end('途中です。おわり。')
      expect(onIdle).toHaveBeenCalledTimes(1)
    })
  })

  // 「要点は声、詳細は画面」は文字数の予算ではなく中身の種類（コード/CLIを落とす）で線を引く。
  // 地の文である以上、長さでは打ち切らない
  describe('要点＝地の文の読み上げ', () => {
    it('長い地の文でも打ち切らずに全部読む', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1)

      const longSentence = `${'あ'.repeat(200)}。`
      narration.feed(`${longSentence}まだ続きます。`)

      expect(spoken).toEqual([longSentence, 'まだ続きます。'])
    })

    it('コードブロックは読み上げに乗らない（takeCompleteSentences が事前に落とす）', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1)

      const full = 'まず要点です。\n```bash\nnpm run dev\n```\n以上です。'
      narration.feed(full)
      narration.end(full)

      expect(spoken.join('')).not.toContain('npm run dev')
      expect(spoken).toEqual(['まず要点です。', '以上です。'])
    })
  })

  describe('割り込み後の文数制限', () => {
    it('複数チャンクで3文以上届いても冒頭2文だけ読む', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1, 'ja-JP', { maxSentences: 2 })
      narration.feed('一文目。')
      narration.feed('一文目。二文目。三文目。')
      narration.feed('一文目。二文目。三文目。四文目。')
      expect(spoken).toEqual(['一文目。', '二文目。'])
    })

    it('上限後は end でも残りを読まず、終了を通知する', () => {
      const { spoken } = installFakeSpeech()
      const onIdle = vi.fn()
      const narration = useVoiceNarration(onIdle)
      narration.begin(1, 'ja-JP', { maxSentences: 2 })
      narration.feed('一文目。二文目。')
      expect(onIdle).not.toHaveBeenCalled()
      narration.end('一文目。二文目。三文目。最後の断片')
      expect(spoken).toEqual(['一文目。', '二文目。'])
      expect(onIdle).toHaveBeenCalledTimes(1)
    })

    it('end だけに届いた本文にも上限を適用する', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1, 'ja-JP', { maxSentences: 2 })
      narration.end('一文目。二文目。三文目。')
      expect(spoken).toEqual(['一文目。', '二文目。'])
    })

    it('上限未満なら最後の断片を読み、次の begin で上限を省略すれば全文を読む', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1, 'ja-JP', { maxSentences: 2 })
      narration.feed('一文目。')
      narration.end('一文目。断片')
      expect(spoken).toEqual(['一文目。', '断片'])
      spoken.length = 0
      narration.begin(1)
      narration.feed('一文目。二文目。三文目。')
      narration.end('一文目。二文目。三文目。断片')
      expect(spoken).toEqual(['一文目。', '二文目。', '三文目。', '断片'])
    })
  })

  // 三体モードと音声の緊張への対処（方針C：球体＋相槌で埋める）
  describe('相槌', () => {
    it('副体が考えている間に相槌を入れる', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(3)

      expect(spoken).toEqual([])
      vi.advanceTimersByTime(FILLER_DELAY_MS)
      expect(spoken).toEqual(['三人で考えています'])
    })

    it('begin に渡した lang が相槌の文言にも反映される', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(3, 'en-US')

      vi.advanceTimersByTime(FILLER_DELAY_MS)
      expect(spoken).toEqual(['three people are thinking'])
    })

    it('単体モードでは相槌を入れない（間が空かないため）', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(1)

      vi.advanceTimersByTime(FILLER_DELAY_MS * 2)
      expect(spoken).toEqual([])
    })

    it('相槌より先に本文が始まったら相槌は出さない（言葉を被せない）', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(3)

      narration.feed('もう答えます。')
      vi.advanceTimersByTime(FILLER_DELAY_MS * 2)

      expect(spoken).toEqual(['もう答えます。'])
    })
  })

  // 停止ボタン・バージインの両方がここを通る
  describe('stop', () => {
    it('喋っているものも待機中の相槌も捨てる', () => {
      const { spoken, cancel } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(3)

      narration.stop()
      vi.advanceTimersByTime(FILLER_DELAY_MS * 2)

      expect(cancel).toHaveBeenCalled()
      expect(spoken).toEqual([])
    })

    it('停止後に本文が届いても読み上げない', () => {
      const { spoken } = installFakeSpeech()
      const narration = useVoiceNarration()
      narration.begin(2)
      narration.stop()

      narration.feed('止めたあとの本文です。')
      narration.end('止めたあとの本文です。')

      expect(spoken).toEqual([])
    })
  })
})
