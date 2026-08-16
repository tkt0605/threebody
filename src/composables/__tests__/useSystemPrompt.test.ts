import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildBodyPersonaPrompt } from '../useSystemPrompt'
import type { Settings, BodyConfig } from '../useSettings'

// 設定層を6層から4層へ削る作業の「変更前」を固定するためのテスト。
// buildSystemPrompt は BASE_PERSONA + LANGUAGE + VOICE_STYLE + LEVEL_STYLE +
// PRESET_EXTRA + 追加指示 を積む。層が減ったこと・口調の指示が VOICE_STYLE の
// 1箇所へ寄ったことを、スナップショットの差分として目視できる状態にしておく。
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
    preset:        'general',
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

  it('preset: coding × language: en', () => {
    expect(buildSystemPrompt(makeSettings({ preset: 'coding', language: 'en' })))
      .toMatchSnapshot()
  })

  it('既定値（warm / general / ja / Lv3）', () => {
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
