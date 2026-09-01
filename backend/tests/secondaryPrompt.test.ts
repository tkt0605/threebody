import { describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import {
  buildReviewMessages, buildReviewSystemPrompt, buildSecondaryMessages,
  buildSecondarySystemPrompt, hasReviewFinding, needsMultiBody, resolveSecondaryRole,
  reviewRoleLabel, secondaryRoleLabel,
} from '../llm/secondaryPrompt'

const text = (m: OpenAI.Chat.ChatCompletionMessageParam) =>
  typeof m.content === 'string' ? m.content : ''

describe('buildSecondarySystemPrompt', () => {
  // 副体2体が同じことを言う原因は、態度（楽観/懐疑）の違いしか無かったこと。
  // 役ごとに「答える対象」そのものを変えているのを固定する
  it('役ごとに別の見出しを要求する（同じ答えが返る余地を無くす）', () => {
    const skeptic  = buildSecondarySystemPrompt('skeptic')
    const optimist = buildSecondarySystemPrompt('optimist')
    const realist  = buildSecondarySystemPrompt('realist')

    expect(skeptic).toContain('崩れる点:')
    expect(optimist).toContain('別の見方:')
    expect(realist).toContain('最初の一手:')

    expect(skeptic).not.toContain('別の見方:')
    expect(optimist).not.toContain('崩れる点:')
    expect(realist).not.toContain('崩れる点:')
  })

  // 「なるほど」で始めて普通に回答していたのは、会話人格（アイリス）の
  // 「相槌は『なるほど』」がそのまま副体に渡っていたため
  it('会話としての受け答えと、問い全体への回答を禁じる', () => {
    const prompt = buildSecondarySystemPrompt('skeptic')

    expect(prompt).toContain('ユーザーではない')
    expect(prompt).toContain('問い全体への答えを書かない')
    expect(prompt).toContain('なるほど')  // 禁止語として挙げている側
    // 事実の規律は層1（CORE_PRINCIPLES）へ移した。副体にも必ず被っていること
    expect(prompt).toContain('知らないことは知らないと書く')
    expect(prompt).toContain('確認していない前提があれば「未確認: ○○」と続ける')
  })
})

describe('buildSecondaryMessages', () => {
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user',      content: '最初の質問' },
    { role: 'assistant', content: `${'古い回答。'.repeat(200)}` },
    { role: 'user',      content: '同じことをもう一度聞く。設計はどうする？' },
  ]

  // 繰り返し聞くほど答えが薄くなっていたのは、履歴に主体の過去回答が積まれ、
  // 副体がそれを読んで「すでに述べたとおり」の側へ逃げていたため
  it('履歴を user 1件へ畳み、直前の問いは冒頭だけ渡す', () => {
    const msgs = buildSecondaryMessages(history, 'skeptic')

    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('user')
    expect(text(msgs[0]!)).toContain('同じことをもう一度聞く')
    expect(text(msgs[0]!)).toContain('【直前の問い】')
    expect(text(msgs[0]!)).toContain('最初の質問')
    expect(text(msgs[0]!).length).toBeLessThan(700)
  })

  // 主体が一度間違えた固有名を副体が復唱し、それを主体がまた採る閉ループを断つ。
  // 渡してよいのはユーザー自身の言葉（問い）だけで、検証されていない回答は渡さない
  it('直前の「回答」は一切渡さない（誤った固有名が世代を超えて増殖する経路）', () => {
    const contaminated: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user',      content: '6か国の教育支出をまとめて' },
      { role: 'assistant', content: 'OECDのEDUstatsデータベースを参照してください。' },
      { role: 'user',      content: 'もっと詳しく' },
    ]
    const body = text(buildSecondaryMessages(contaminated, 'realist')[0]!)

    expect(body).not.toContain('EDUstats')
    expect(body).not.toContain('OECD')
    expect(body).toContain('6か国の教育支出をまとめて')
  })

  it('作業指示を user ターンにも置く（小さいモデルは system より直近に従う）', () => {
    expect(text(buildSecondaryMessages(history, 'realist')[0]!)).toContain('【あなたの作業】')
    expect(text(buildSecondaryMessages(history, 'realist')[0]!)).toContain('今日から着手できる')
    expect(text(buildSecondaryMessages(history, 'skeptic')[0]!)).toContain('失敗しやすい箇所')
  })

  it('1往復目は「直前の問い」を付けない', () => {
    const msgs = buildSecondaryMessages([{ role: 'user', content: '設計はどうする？' }], 'skeptic')
    expect(text(msgs[0]!)).not.toContain('【直前の問い】')
  })
})

describe('needsMultiBody', () => {
  it('挨拶や相槌では副体を呼ばない', () => {
    for (const t of ['おはよう', 'ありがとう', 'うん、そうだね', '了解']) {
      expect(needsMultiBody([{ role: 'user', content: t }])).toBe(false)
    }
  })

  it('疑問符があれば短くても呼ぶ', () => {
    expect(needsMultiBody([{ role: 'user', content: 'なぜ？' }])).toBe(true)
  })

  it('中身のある依頼は疑問符が無くても呼ぶ', () => {
    expect(needsMultiBody([{ role: 'user', content: 'WebSocketを使うチャットアプリを作りたい' }])).toBe(true)
  })
})

describe('resolveSecondaryRole', () => {
  // 古いフロント（personaPrompt を送っていた頃のバンドル）や curl から来た
  // リクエストでも、副体2体に別々の役が当たること
  it('role が無ければ並び順で別々の役を割り当てる', () => {
    expect(resolveSecondaryRole(undefined, 0)).not.toBe(resolveSecondaryRole(undefined, 1))
  })

  it('未知の値は既定の役へ落とす', () => {
    expect(secondaryRoleLabel(resolveSecondaryRole('unknown-role', 0))).toBe('崩れる点')
  })
})

// ── 検算モード（本番経路） ────────────────────────────────────────────
// 上の buildSecondary* は実験専用へ降格した旧・統合方式のもの。
// 本番の副体はここから下の buildReview* を通る
describe('buildReviewSystemPrompt', () => {
  it('役ごとに別の対象を検証させる（見る対象が問いから答えへ移っても割れ方は保つ）', () => {
    const skeptic  = buildReviewSystemPrompt('skeptic')
    const optimist = buildReviewSystemPrompt('optimist')
    const realist  = buildReviewSystemPrompt('realist')

    expect(skeptic).toContain('崩れやすい箇所')
    // realist は「最初の一手」から「抜けが関わる箇所」へ。答えが既にあるので、
    // 着手の一手ではなく答えの欠落を見る役に変わった
    expect(realist).toContain('抜けが関わる箇所')
    expect(realist).not.toContain('最初の一手')
    expect(optimist).toContain('答えが採った筋')

    expect(skeptic).not.toContain('抜けが関わる箇所')
    expect(optimist).not.toContain('崩れやすい箇所')
  })

  // 見出し（カードのラベル）と判定・対象箇所を別フィールドに分けた。1行目の文字列
  // だけを見ていた旧実装では、対象箇所が答えに実在するかを誰も検証していなかった
  it('4フィールド（判定・対象箇所・根拠・代替案）の形式を要求する', () => {
    const prompt = buildReviewSystemPrompt('skeptic')
    expect(prompt).toContain('判定:')
    expect(prompt).toContain('対象箇所:')
    expect(prompt).toContain('根拠:')
    expect(prompt).toContain('代替案:')
  })

  it('対象箇所を答えからの引用に限定する', () => {
    const prompt = buildReviewSystemPrompt('skeptic')
    expect(prompt).toContain('答えの文言を変えずに引用する')
    expect(prompt).toContain('答えに実在しない引用は')
  })

  // 検算が答えを書き直し始めると、画面に答えが2つ並ぶ。
  // 副体は主体より小さいモデルなので、後から出た劣った答えが最後に残る
  it('答えの書き直しと、答え全体への講評を禁じる', () => {
    const prompt = buildReviewSystemPrompt('skeptic')

    expect(prompt).toContain('答えを書き直さない')
    expect(prompt).toContain('作り直した答え・コード・手順を書かない')
    expect(prompt).toContain('要約や講評を書かない')
    expect(prompt).toContain('なるほど')  // 禁止語として挙げている側
  })

  // 統合方式の頃のメモは主体だけが読む中間生成物で、単体では意味の取れない断片が多かった。
  // 検算の出力はそのままユーザーに読まれるので、宛先を偽らない
  it('読むのがユーザーであることを明示する', () => {
    const prompt = buildReviewSystemPrompt('realist')

    expect(prompt).toContain('ユーザーに読まれる')
    expect(prompt).not.toContain('ユーザーではない')
  })

  // 無い指摘をひねり出すと、答えが正しいときほど的外れなカードが並ぶ
  it('指摘が無いときの逃げ道を用意する', () => {
    expect(buildReviewSystemPrompt('optimist')).toContain('指摘なし')
  })

  it('事実の規律（層1）が必ず被っている', () => {
    for (const role of ['skeptic', 'optimist', 'realist'] as const) {
      expect(buildReviewSystemPrompt(role)).toContain('知らないことは知らないと書く')
    }
  })
})

describe('buildReviewMessages', () => {
  it('問いと主体の答えだけを user 1件で渡す', () => {
    const msgs = buildReviewMessages('設計はどうする？', 'まず SSE で繋ぐ。', 'skeptic')

    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('user')
    expect(text(msgs[0]!)).toContain('【問い】')
    expect(text(msgs[0]!)).toContain('設計はどうする？')
    expect(text(msgs[0]!)).toContain('【答え】')
    expect(text(msgs[0]!)).toContain('まず SSE で繋ぐ。')
  })

  it('作業指示を user ターンにも置く（小さいモデルは system より直近に従う）', () => {
    expect(text(buildReviewMessages('q', 'a', 'realist')[0]!)).toContain('【あなたの作業】')
    expect(text(buildReviewMessages('q', 'a', 'realist')[0]!)).toContain('答えは書き直さない')
    expect(text(buildReviewMessages('q', 'a', 'skeptic')[0]!)).toContain('最も崩れやすい箇所')
    expect(text(buildReviewMessages('q', 'a', 'realist')[0]!)).toContain('答えに書かれていない')
  })

  // 入力は体の数だけ倍化する。長い答えをそのまま渡すと、検算1回のコストが本文を超える
  it('長い答えは上限で切り、切ったことを明示する', () => {
    const long = 'あ'.repeat(5000)
    const body = text(buildReviewMessages('q', long, 'skeptic')[0]!)

    expect(body).toContain('…（以下略）')
    // 切るのは末尾。答えの結論は前半に出るので冒頭は必ず残る
    expect(body).toContain('あ'.repeat(3000))
    expect(body).not.toContain('あ'.repeat(3001))
  })

  it('上限より短い答えは切らない', () => {
    const body = text(buildReviewMessages('q', 'みじかい答え', 'skeptic')[0]!)
    expect(body).not.toContain('…（以下略）')
  })
})

describe('reviewRoleLabel', () => {
  // カードの見出しになる。旧 secondaryRoleLabel と realist だけ食い違うので、
  // 取り違えるとカードに「最初の一手」と出たまま中身が「抜けている点」になる
  it('検算の見出しを返す（旧・統合方式の見出しとは realist が異なる）', () => {
    expect(reviewRoleLabel('skeptic')).toBe('崩れる点')
    expect(reviewRoleLabel('optimist')).toBe('別の見方')
    expect(reviewRoleLabel('realist')).toBe('抜けている点')
    expect(secondaryRoleLabel('realist')).toBe('最初の一手')
  })
})

// 「指摘が出たか」の判定はここ1箇所だけ。SSE の body_done と content_blocks の payload の
// 両方がこの結果を運ぶので、ここが緩むと後段（実例の自動抽出）が丸ごとずれる
describe('hasReviewFinding', () => {
  const answer = '認証はセッションCookieで行い、トークンの有効期限は24時間とする。'

  it('対象箇所が答えに実在する引用なら true', () => {
    const content = '判定: 指摘あり\n対象箇所: トークンの有効期限は24時間とする\n根拠: 短すぎて頻繁に再ログインが必要になる\n代替案: 7日程度に延ばす'
    expect(hasReviewFinding(content, answer)).toBe(true)
  })

  it('判定が「指摘なし」なら false', () => {
    expect(hasReviewFinding('判定: 指摘なし\n対象箇所: ―\n根拠: ―\n代替案: ―', answer)).toBe(false)
    expect(hasReviewFinding('指摘なし', answer)).toBe(false)
    expect(hasReviewFinding('指摘は特にありません', answer)).toBe(false)
  })

  // 判定だけを見ていた旧実装の穴。「指摘あり」と書きさえすれば対象箇所が答えに
  // 実在するかは誰も確かめていなかった
  it('対象箇所が答えに実在しない（でっち上げ）なら、判定が「指摘あり」でも false', () => {
    const content = '判定: 指摘あり\n対象箇所: 存在しないOECDのEDUstats\n根拠: 出典が不明\n代替案: 出典を明記する'
    expect(hasReviewFinding(content, answer)).toBe(false)
  })

  // 短すぎる対象箇所は答えのほぼどの一文にも部分一致してしまい、引用の強制が意味を持たない
  it('対象箇所が短すぎるなら false', () => {
    const content = '判定: 指摘あり\n対象箇所: とする\n根拠: …\n代替案: …'
    expect(hasReviewFinding(content, answer)).toBe(false)
  })

  it('対象箇所の行が無ければ false（判定だけでは指摘を認めない）', () => {
    const content = '判定: 指摘あり\n根拠: …\n代替案: …'
    expect(hasReviewFinding(content, answer)).toBe(false)
  })

  // 副体は対象箇所を「」で囲んだり、句読点の前後にスペースを入れることがある
  it('空白・引用符の違いは引用照合の邪魔をしない', () => {
    const content = '判定: 指摘あり\n対象箇所: 「トークンの有効期限は 24時間 とする」\n根拠: 短すぎて頻繁に再ログインが必要になる\n代替案: …'
    expect(hasReviewFinding(content, answer)).toBe(true)
  })

  it('空（副体が落ちた）は false', () => {
    expect(hasReviewFinding('', answer)).toBe(false)
    expect(hasReviewFinding('   \n ', answer)).toBe(false)
  })

  // 実測（ToDoアプリの設計相談）: モデルは「一字一句引用する」と指示しても、引用の前後に
  // 説明の地の文を混ぜて書く。対象箇所"全体"が答えの部分文字列であることを要求すると、
  // 判定が「指摘あり」でも一致せず false へ倒れていた（旧実装の穴）
  it('引用に説明の地の文が混ざっていても、答えからの一致区間があれば true', () => {
    const content = '判定: 指摘あり\n対象箇所: 「トークンの有効期限は24時間とする」のように短い値を決め打ちしている部分\n根拠: 短すぎて頻繁に再ログインが必要になる\n代替案: …'
    expect(hasReviewFinding(content, answer)).toBe(true)
  })

  // 実測（scripts/view-shared.mjs で割れた率を確認した際のサンプル）: 対象箇所は答えに
  // 実在する引用でも、根拠が「〜というメリットが挙げられている」のような対象箇所の
  // 言い換えに留まり、何が崩れる／抜けているかに触れていない指摘が複数見つかった。
  // 厳密な具体性判定は文字列処理だけでは不可能なので、まずは著しく短い／
  // プレースホルダーの根拠だけを機械的に弾く
  it('根拠が極端に短い（実質からっぽ）なら、判定・対象箇所が揃っていても false', () => {
    const content = '判定: 指摘あり\n対象箇所: トークンの有効期限は24時間とする\n根拠: 微妙\n代替案: 7日程度に延ばす'
    expect(hasReviewFinding(content, answer)).toBe(false)
  })

  it('根拠がプレースホルダー（―のみ）なら false', () => {
    const content = '判定: 指摘あり\n対象箇所: トークンの有効期限は24時間とする\n根拠: ―\n代替案: 7日程度に延ばす'
    expect(hasReviewFinding(content, answer)).toBe(false)
  })

  it('根拠の行が無ければ false', () => {
    const content = '判定: 指摘あり\n対象箇所: トークンの有効期限は24時間とする\n代替案: 7日程度に延ばす'
    expect(hasReviewFinding(content, answer)).toBe(false)
  })
})
