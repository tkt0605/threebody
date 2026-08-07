// 共有APIキーのフォールバック。
// APIキーを設定していないユーザーでも、1日数回まで運営のキーで対話を試せるようにする。
//
// 共有キーが存在してよいのは Render の環境変数とこのプロセスのメモリ上だけ。
// DBに入るのは「使ってよいか」と「今日何回使ったか」だけで、キーそのものは入らない。
import { getSupabaseAdmin } from './supabaseAdmin'
import { jstDateString } from './utils/jstDate'

// 1ユーザーあたりの1日の上限。
// Phase 0で単体1回→三体3回分のコストになったため、5→3へ引き下げ
export const SHARED_DAILY_LIMIT = 3

// 共有キー利用時に固定する思考レベル。
// レベル5(Opus/32Kトークン)とレベル2(Haiku/4Kトークン)では単価が約40倍違う。
// 他人のトークンを運営が負担する以上、ここはユーザーに選ばせない
export const SHARED_THINKING_LEVEL = 2

export type SharedAllowance =
  | { allowed: true;  remaining: number }
  | { allowed: false; reason: 'unavailable' | 'not_signed_in' | 'not_permitted' | 'limit_reached' }

export function sharedApiKey(): string | null {
  const key = process.env.SHARED_ANTHROPIC_API_KEY?.trim()
  return key ? key : null
}

// 「APIキー未設定」の判定。
// server.ts の available フィルタは ollama を無条件 true にするため、
// available.length === 0 では未設定を検出できない（ollamaの体が常に残る）。
// クラウド系(anthropic/openai/deepseek)で apiKey と model が揃った体が
// 1つも無い状態を未設定とみなす
type KeyCandidate = { provider?: string | undefined; apiKey?: string | undefined; model?: string | undefined }

function isUsableCloudKey(c: KeyCandidate): boolean {
  return c.provider !== undefined
    && c.provider !== 'ollama'
    && (c.apiKey?.trim().length ?? 0) > 0
    && (c.model?.trim().length  ?? 0) > 0
}

export function hasOwnCloudKey(source: {
  bodies?: readonly KeyCandidate[] | undefined
} & KeyCandidate): boolean {
  // 三体モード（bodies配列）と単体モード（provider/model/apiKey直指定）の両方を見る
  if ((source.bodies ?? []).some(isUsableCloudKey)) return true
  return isUsableCloudKey(source)
}

type QuotaRow = {
  can_use_shared_key:    boolean | null
  shared_daily_count:    number  | null
  shared_last_used_date: string  | null
}

// 今日すでに何回使ったか。日付が変わっていれば 0 に戻す。
// 判定と保存で必ず同じ jstDateString() を呼ぶこと（片方だけ別計算にすると日跨ぎで不整合が出る）
function usedToday(row: QuotaRow, today: string): number {
  if (row.shared_last_used_date !== today) return 0
  return row.shared_daily_count ?? 0
}

export async function checkSharedAllowance(userId: string | null): Promise<SharedAllowance> {
  if (!sharedApiKey())  return { allowed: false, reason: 'unavailable'   }
  if (!userId)          return { allowed: false, reason: 'not_signed_in' }

  const admin = getSupabaseAdmin()
  if (!admin) return { allowed: false, reason: 'unavailable' }

  const { data, error } = await admin
    .from('user_setting')
    .select('can_use_shared_key, shared_daily_count, shared_last_used_date')
    .eq('id', userId)
    .maybeSingle<QuotaRow>()

  // 行が無い・読めない場合は「許可されていない」に倒す。
  // 判断できないときに使わせる側へ倒すと、運営のキーが無制限に使われうる
  if (error || !data) return { allowed: false, reason: 'not_permitted' }
  if (!data.can_use_shared_key) return { allowed: false, reason: 'not_permitted' }

  const used = usedToday(data, jstDateString())
  if (used >= SHARED_DAILY_LIMIT) return { allowed: false, reason: 'limit_reached' }

  return { allowed: true, remaining: SHARED_DAILY_LIMIT - used }
}

// 消費を1回分記録する。呼ぶのは「共有キーを使い、かつ応答が正常完了した」ときだけ。
//
// DB側の consume_shared_quota（単一UPDATE文、行ロックで直列化）を呼ぶことで原子的に加算する。
// 読んでから書く実装だと、その間に別リクエストが割り込んで同じ値を上書きしうる
// （並列に投げれば上限をすり抜けられる）ため、RPC側に寄せてある
export async function consumeSharedQuota(userId: string): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return

  // 判定（checkSharedAllowance）と保存で計算がずれると日跨ぎで不整合が出るため、
  // ここも必ず jstDateString() を使う
  const { error } = await admin.rpc('consume_shared_quota', {
    p_user_id: userId,
    p_today:   jstDateString(),
  })

  // カウントに失敗しても応答そのものは既に返し終えている。
  // ここで throw しても取り消せないので、記録に残して続行する
  if (error) console.error('[sharedKey] 利用回数の記録に失敗しました', error.message)
}
