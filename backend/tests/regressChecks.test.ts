import { describe, it, expect } from 'vitest'
// @ts-expect-error -- 回帰ハーネスは .mjs で型を持たない。判定式だけを取り出して検証する
import { CHECKS, QUESTIONS } from '../../scripts/regress.mjs'

// 判定式そのものが回帰の対象。ハーネスは実サーバーが要るので普段は走らないが、
// 「合格の条件」が壊れると、壊れたまま合格が出て気づけない。式だけはここで固定する。
//
// 契約は検算方式（主体が先に答え、副体が検算する）に合わせてある。
// 旧 E1・E2（副体の見出し／見解ラベルが主体本文に混入）は主体が副体を見なくなり
// 構造上落ちなくなったため廃止。旧 H は測る対象を絞り直した

type CheckArgs = {
  primary?: string
  bodies?: { name: string; provider: string; text: string }[]
  prevPrimary?: string | null
  review?: boolean | null
}
type Verdict = { ok: boolean | null; note?: string }
const run = (id: string, args: CheckArgs): Verdict =>
  (CHECKS as Record<string, { run: (a: CheckArgs) => Verdict }>)[id]!.run({
    primary: '', bodies: [], prevPrimary: null, review: null, ...args,
  })

const card = (name: string, text: string) => ({ name, provider: 'ollama', text })

describe('廃止した判定が残っていない', () => {
  // 落ちない判定を合格として数えると、合格数が実力ではなく設計の副産物になる
  it('E1・E2 は削除されている', () => {
    expect(CHECKS).not.toHaveProperty('E1')
    expect(CHECKS).not.toHaveProperty('E2')
  })

  it('どの問いも E1・E2 を参照していない', () => {
    for (const q of QUESTIONS as { id: string; checks: string[] }[]) {
      expect(q.checks).not.toContain('E1')
      expect(q.checks).not.toContain('E2')
      // 参照している判定はすべて実在すること（改名時の取りこぼし検出）
      for (const id of q.checks) expect(CHECKS).toHaveProperty(id)
    }
  })
})

describe('R1 副体が指定の見出しで書いた', () => {
  it('見出しどおりなら合格', () => {
    expect(run('R1', { bodies: [card('崩れる点', '崩れる点: 出典が未確認\nなぜ: …\n確度: 中')] }).ok).toBe(true)
  })

  it('【】付きの見出しも認める', () => {
    expect(run('R1', { bodies: [card('抜けている点', '【抜けている点】: 認証の扱い')] }).ok).toBe(true)
  })

  it('「指摘なし」は逃げ道として合格', () => {
    expect(run('R1', { bodies: [card('別の見方', '指摘なし')] }).ok).toBe(true)
  })

  it('会話として普通に答えたら不合格', () => {
    const v = run('R1', { bodies: [card('崩れる点', 'なるほど、いい質問ですね。まず結論から言うと…')] })
    expect(v.ok).toBe(false)
    expect(v.note).toContain('崩れる点')
  })

  it('副体が走らなかった run は合否に数えない', () => {
    expect(run('R1', { bodies: [] }).ok).toBeNull()
  })
})

describe('R2 副体が答えを書き直していない', () => {
  it('指摘だけなら合格', () => {
    expect(run('R2', { bodies: [card('崩れる点', '崩れる点: 出典が未確認')] }).ok).toBe(true)
  })

  // 副体は主体より小さいモデル。書き直しを許すと劣った答えが最後に残る
  it('コードを書いたら不合格', () => {
    expect(run('R2', { bodies: [card('崩れる点', '崩れる点: 型が緩い\n```ts\nconst a = 1\n```')] }).ok).toBe(false)
  })

  it('作り直しの宣言を不合格にする', () => {
    for (const word of ['修正版', '書き直す', '以下に改善', '改訂版']) {
      expect(run('R2', { bodies: [card('崩れる点', `崩れる点: X\n${word}: …`)] }).ok).toBe(false)
    }
  })
})

describe('R3 副体が答えの中身に即している', () => {
  it('答えの語を使っていれば合格', () => {
    const v = run('R3', {
      primary: 'まず Supabase の認証を通してから、SSE でストリーミングします。',
      bodies:  [card('崩れる点', '崩れる点: Supabase のトークン期限が抜けている')],
    })
    expect(v.ok).toBe(true)
  })

  it('答えの語を1つも使わない一般論は不合格', () => {
    const v = run('R3', {
      primary: 'まず Supabase の認証を通してから、SSE でストリーミングします。',
      bodies:  [card('崩れる点', '崩れる点: 一般に計画は失敗しやすい')],
    })
    expect(v.ok).toBe(false)
    expect(v.note).toContain('崩れる点')
  })
})

describe('H 今ターンの答え以外の過去本文が副体に無い', () => {
  const past = 'OECDのEDUstatsデータベースを参照してください。これは各国の統計を集めたものです。'

  // 検算方式では今ターンの答えを副体へ渡すのが仕様。渡したものが副体に現れるのは汚染ではない
  it('今ターンの答え経由で現れた一致は汚染としない', () => {
    const v = run('H', {
      primary:     past,
      prevPrimary: past,
      bodies:      [card('崩れる点', `崩れる点: ${past.slice(0, 30)} が未確認`)],
    })
    expect(v.ok).toBe(true)
  })

  // 渡していないはずの過去本文が出てきたら、履歴がどこかから流れ込んでいる
  it('今ターンの答えに無い過去本文の逐語一致は不合格', () => {
    const v = run('H', {
      primary:     '今回はまったく別の話をします。',
      prevPrimary: past,
      bodies:      [card('崩れる点', `崩れる点: ${past.slice(0, 30)}`)],
    })
    expect(v.ok).toBe(false)
    expect(v.note).toContain('逐語一致')
  })

  it('前ターンが無ければ合格', () => {
    expect(run('H', { prevPrimary: null, bodies: [card('崩れる点', 'なにか')] }).ok).toBe(true)
  })
})

describe('F 検算へ回さず単体で答えた', () => {
  it('副体が走らず review が false なら合格', () => {
    expect(run('F', { bodies: [], review: false }).ok).toBe(true)
  })

  it('副体が走ったら不合格', () => {
    expect(run('F', { bodies: [card('崩れる点', 'x')], review: true }).ok).toBe(false)
  })

  // review:true なのに body_start が来ないのは、副体が全滅した状態。
  // 挨拶の縮退と見分けが付かなくなるので、合格にはしない
  it('review が true なのに副体が走らないのは不合格', () => {
    expect(run('F', { bodies: [], review: true }).ok).toBe(false)
  })
})
