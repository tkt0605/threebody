// ログイン後に戻る先を1つだけ覚えておく。
//
// 【なぜ要るか】共有ページ（ROADMAP ③）の導線は「同じ問いを自分のモデルで検算させる」で、
// 未ログインの閲覧者はそこからログインへ回る。素通しにすると、戻ってきたときには
// 問いが消えていて、押した意味が無くなる。
//
// 【なぜURLではなく sessionStorage か】Google OAuth のリダイレクト先（redirectTo）は
// Supabase 側の許可リストと一致していなければならず、query を足すと認証そのものが
// 弾かれうる。行き先はブラウザに預け、/auth/callback で拾い直す。
const KEY = 'threebody-post-login'

// 受け取るのはアプリ内のパスだけ。'//example.com' は URL としては外部を指すため弾く
// （行き先をそのまま router.replace に渡す以上、ここが唯一の検問になる）
function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

export function rememberPostLogin(path: string): void {
  if (!isInternalPath(path) || path === "/" ) return
  try {
    sessionStorage.setItem(KEY, path)
  } catch (e) { console.log('[postLogin] remember: threw', e) /* プライベートモード等では諦める */ }
}

// 読むのは1回だけ。残すと、次に普通にログインした人まで前回の行き先へ飛ばされる
export function takePostLogin(): string | null {
  try {
    const path = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return path && isInternalPath(path) ? path : null
  } catch (e) {
    return null
  }
}
