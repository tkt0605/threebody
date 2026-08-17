// 利用規約・プライバシーポリシーの両方から参照する事実。
//
// 【なぜ定数にするか】規約とプライバシーポリシーで施行日や連絡先がズレると、
// どちらが正なのか外から判断できなくなる。ここ1箇所を直せば両方に反映される。

// 運営者の表示名。個人開発のため屋号ではなく開発者名を出す。
export const OPERATOR_NAME = '駒田 隆人'

// 開示・削除の請求と、規約・プライバシーポリシーに関する問い合わせの受け口。
// 個人情報保護法の「利用停止・消去の請求」を受け付ける窓口として必須。
export const CONTACT_EMAIL = 'takatokomada17@gmail.com'

export const SERVICE_NAME = 'ThreeBody'
export const SERVICE_URL  = 'https://threebody-phi.vercel.app'

// 施行日 / 最終改定日。改定したらここを更新する
export const LEGAL_EFFECTIVE_DATE = '2026年8月14日'
