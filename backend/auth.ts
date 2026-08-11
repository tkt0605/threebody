// リクエストの Authorization ヘッダから「誰が投げてきたか」を確定する。
//
// 共有APIキーは「認証済み かつ can_use_shared_key が true のユーザー」にだけ使わせる。
// その判定には userId が要るが、これまで /api/chat は req.body しか見ておらず、
// リクエスト元を知る手段が一切なかった。ここがその入口になる。
//
// 【この関数自体は throw しないし、null も返しうる】
// トークンが無い・検証できない場合は null を返す。判定の結果をどう扱うかは
// 呼び出し側の責任で、経路によって異なる：
//
//   - POST /api/chat        … null なら 401。かつては「BYOKユーザーを締め出さない」
//                             ために null を許していたが、それはこのサーバーを誰でも
//                             LLMプロキシとして踏み台にできる状態でもあった。
//                             フロントは全画面ログイン必須なので必須化しても後退が無い
//   - GET /api/capabilities … null のまま peekSharedAllowance へ渡す。
//                             「未ログインだから共有キーが使えない」を画面に出すため、
//                             ここで弾いてしまうと理由を伝えられなくなる
import { getSupabaseAdmin } from './supabaseAdmin'

const BEARER_PREFIX = 'bearer '

// ヘッダの解析だけを担う純関数。ネットワークに触らないので単体で検証できる。
// RFC 7235 のスキーム名は大文字小文字を区別しないため、比較は小文字に倒してから行う
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null
  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) return null
  const token = header.slice(BEARER_PREFIX.length).trim()
  return token.length > 0 ? token : null
}

// トークンを検証して userId を返す。確定できなければ null。
// この関数は決して throw しない。Supabaseへの疎通が落ちていても、
// 共有キーが使えなくなるだけで会話そのものは続けられるようにする
export async function resolveUserId(header: string | undefined): Promise<string | null> {
  const token = extractBearerToken(header)
  if (!token) return null

  const admin = getSupabaseAdmin()
  if (!admin) return null

  try {
    // service key のクライアントに引数としてトークンを渡す形。
    // これはトークン単体の検証で、クライアントの認証状態は変化しない
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) return null
    return data.user.id
  } catch {
    // ネットワーク断・Supabase障害など。トークンの中身はログに出さない
    console.warn('[auth] ユーザーの特定に失敗しました')
    return null
  }
}
