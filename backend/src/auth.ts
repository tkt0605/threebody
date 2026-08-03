// リクエストの Authorization ヘッダから「誰が投げてきたか」を確定する。
//
// 共有APIキーは「認証済み かつ can_use_shared_key が true のユーザー」にだけ使わせる。
// その判定には userId が要るが、これまで /api/chat は req.body しか見ておらず、
// リクエスト元を知る手段が一切なかった。ここがその入口になる。
//
// 【認証を必須にしない理由】
// トークンが無ければ null を返し、呼び出し側は従来どおり処理を続ける。
// 必須にすると、自分のAPIキーで動いている既存ユーザー（BYOK）まで締め出すことになる。
// null は「共有キーは使えない」を意味するだけで、エラーではない。
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
