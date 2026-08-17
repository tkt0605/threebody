import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildBodyPersonaPrompt } from '../useSystemPrompt'
import type { Settings, BodyConfig } from '../useSettings'

// 設定層を6層から4層へ削る作業のために置いたテスト。
// 着手前の buildSystemPrompt は BASE_PERSONA + LANGUAGE + VOICE_STYLE + LEVEL_STYLE +
// PRESET_EXTRA + 追加指示 の6層を積んでいた。現在は LEVEL_STYLE と PRESET_EXTRA が
// 廃止され、BASE_PERSONA + LANGUAGE + VOICE_STYLE + 追加指示 の4層になっている。
// 以降も層の増減がスナップショットの差分として目視できる状態を保つ。
//
// 出力そのものが仕様なので、期待値を書き下すのではなくスナップショットで固定する。

// buildSystemPrompt は bodies を読まないが、Settings の型を満たすために要る
const BODIES: [BodyConfig, BodyConfig, BodyConfig] = [
  { role: 'optimist', provider: 'ollama',   apiKey: '', model: '' },
  { role: 'skeptic',  provider: 'openai',   apiKey: '', model: '' },
  { role: 'realist',  provider: 'deepseek', apiKey: '', model: '' },
]

// 既定値は useSettings.ts の reactive 初期値に合わせている
function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    language:      'ja',
    voiceStyle:    'warm',
    thinkingLevel: 3,
    systemPrompt:  '',
    provider:      'ollama',
    bodies:        BODIES,
    ...over,
  }
}

describe('buildSystemPrompt', () => {
  // terse は「相槌を省く」と言うが、BASE_PERSONA は「相槌を返す」と言っている。
  // 矛盾が最も強く出る組み合わせなので、最初に固定しておく
  it('terse × Lv1', () => {
    expect(buildSystemPrompt(makeSettings({ voiceStyle: 'terse', thinkingLevel: 1 })))
      .toMatchSnapshot()
  })

  it('warm × Lv5', () => {
    expect(buildSystemPrompt(makeSettings({ voiceStyle: 'warm', thinkingLevel: 5 })))
      .toMatchSnapshot()
  })

  // 旧 preset 層の削除前は 'preset: coding × language: en' だったケース。
  // preset が設定から消えたため、言語だけの確認に縮んでいる
  it('language: en', () => {
    expect(buildSystemPrompt(makeSettings({ language: 'en' }))).toMatchSnapshot()
  })

  it('既定値（warm / ja / Lv3）', () => {
    expect(buildSystemPrompt(makeSettings())).toMatchSnapshot()
  })
})

describe('buildBodyPersonaPrompt', () => {
  // 副体は buildSystemPrompt の出力の上に視点レイヤーを重ねる。
  // 土台が変われば副体も変わるため、こちらも固定しておく
  it('既定値 × skeptic', () => {
    expect(buildBodyPersonaPrompt(makeSettings(), 'skeptic')).toMatchSnapshot()
  })
})
