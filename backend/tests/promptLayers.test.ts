import { describe, expect, it } from 'vitest'
import { CORE_PRINCIPLES, buildPrimaryPrompt, buildSynthesisLayer } from '../llm/promptLayers'
import { buildSecondarySystemPrompt } from '../llm/secondaryPrompt'

// この2層構造で守りたい不変条件はひとつだけ。
// 「層1が全ての体に必ず入っていること」。以前は同じ規則が主体側と副体側に別々の
// 文面で書かれており、片方だけ直して片方が古くなっていた（実測: 共有キー経路にだけ
// 「コードを書くな」が届いていなかった）。層1が経路のどこかで抜けたらここで落ちる。
describe('層1（共通規範）', () => {
  it('主体（単体モード）に入る', () => {
    expect(buildPrimaryPrompt('あなたはアイリス。')).toContain(CORE_PRINCIPLES)
  })

  it('主体（統合モード）に入る', () => {
    const primary = buildPrimaryPrompt('あなたはアイリス。')
    expect(`${primary}\n\n${buildSynthesisLayer('【崩れる点（ollama）の見解】\nダミー')}`)
      .toContain(CORE_PRINCIPLES)
  })

  it('副体の3役すべてに入る', () => {
    for (const role of ['skeptic', 'optimist', 'realist'] as const) {
      expect(buildSecondarySystemPrompt(role)).toContain(CORE_PRINCIPLES)
    }
  })

  it('人格が空でも層1と層2は残る（既定値が届かない経路でも規範だけは効く）', () => {
    const prompt = buildPrimaryPrompt('')
    expect(prompt).toContain(CORE_PRINCIPLES)
    expect(prompt).toContain('【答え方】')
    expect(prompt.startsWith('【事実の扱い】')).toBe(true)
  })
})

describe('層2（役割ごとの契約）', () => {
  // 層2は役割ごとに違うものが入る。混ざると「副体が答えを書く」「主体がメモの
  // 見出しをそのまま出す」という、この設計で最初に壊れた形に戻る
  it('主体には答え方と出力の器が入り、副体には入らない', () => {
    const primary   = buildPrimaryPrompt('あなたはアイリス。')
    const secondary = buildSecondarySystemPrompt('skeptic')

    expect(primary).toContain('【答え方】')
    expect(primary).toContain('【出力の器】')
    expect(secondary).not.toContain('【答え方】')
    expect(secondary).not.toContain('【出力の器】')
  })

  it('統合固有の層は、見解を本文に含めたうえで単体モードには入らない', () => {
    const perspectives = '【崩れる点（ollama）の見解】\nダミー'

    expect(buildSynthesisLayer(perspectives)).toContain(perspectives)
    expect(buildPrimaryPrompt('あなたはアイリス。')).not.toContain('【他の体の検討メモ】')
  })
})
