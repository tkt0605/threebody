// I0（記録）— 意図をデータにするための器。
//
// ここに入れてよいのは「推論を挟まずに観測できた事実」だけ。停止を押した・割り込んだ・
// 言い直した・同じことを二度聞いた、はすべてユーザーの操作そのものなので外れようがない。
// 表情や語調からの感情推定のような代理変数は入れない（ROADMAP 7章の決定）。
//
// **フィールドは3つで確定。4個目を足さないこと。**
// 記録は貯まるのに時間がかかり、途中で形を変えると貯め直しになる。使い道（システム
// プロンプトへの反映）は I3 の仕事で、I0 は貯めるだけ。
export interface TurnSignals {
  // 生成を止められた ＝「今の答えは要らなかった」。
  // 停止ボタンと barge-in の両方をここへ寄せる。**assistant メッセージに付く**
  interrupted: boolean

  // 言い直した回数 ＝「うまく言えていない」。**user メッセージに付く**
  rephrased: number

  // 同じ主旨を再度聞いた元メッセージのid ＝「前の答えが刺さらなかった」。
  // 判定は正規化した完全一致のみ。類似度による判定は推論なので使わない。
  // **user メッセージに付く**
  repeatOf?: string
}

// 意図がどの経路で表明されたか。これも推論ではなく観測できた事実。
// TurnSignals の4個目のフィールドではなく別の型にしてあるのは、寿命が違うため
// （シグナルは「その回に何が起きたか」、modality は「どう入力されたか」）。
export type Modality = 'text' | 'voice'

// 既定値。シグナルが1つも立っていないメッセージは signals を持たない（DBにも書かない）
export const NO_SIGNALS: TurnSignals = { interrupted: false, rephrased: 0 }

// 既定値と同じなら「記録すべきことが何も起きなかった」とみなす。
// 全メッセージに interrupted:false を書き込むと、シグナルの有無が読み取れなくなる
export function hasSignal(s: TurnSignals | undefined): boolean {
  if (!s) return false
  return s.interrupted || s.rephrased > 0 || s.repeatOf !== undefined
}
