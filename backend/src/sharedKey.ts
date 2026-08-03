// 共有APIキーのフォールバック。
// APIキーを設定していないユーザーでも、1日数回まで運営のキーで対話を試せるようにする。
//
// 共有キーが存在してよいのは Render の環境変数とこのプロセスのメモリ上だけ。
// DBに入るのは「使ってよいか」と「今日何回使ったか」だけで、キーそのものは入らない。
import { getSupabaseAdmin } from './supabaseAdmin'
import { jstDateString } from './jstDate'

// 1ユーザーあたりの1日の上限
export const SHARED_DAILY_LIMIT = 5

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
// 読んでから書くまでの間に別のリクエストが割り込むと、同じ値を上書きしうる
// （並列に投げれば上限をすり抜けられる）。1ユーザー数人規模のMVPでは許容し、
// 本当の天井は Anthropic コンソール側の支出上限で押さえる。
// 厳密にするなら SQL 側に加算関数を置いて1文で更新する
export async function consumeSharedQuota(userId: string): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const today = jstDateString()

  const { data, error } = await admin
    .from('user_setting')
    .select('can_use_shared_key, shared_daily_count, shared_last_used_date')
    .eq('id', userId)
    .maybeSingle<QuotaRow>()
  if (error || !data) return

  const { error: updateError } = await admin
    .from('user_setting')
    .update({
      shared_daily_count:    usedToday(data, today) + 1,
      shared_last_used_date: today,
    })
    .eq('id', userId)

  // カウントに失敗しても応答そのものは既に返し終えている。
  // ここで throw しても取り消せないので、記録に残して続行する
  if (updateError) console.error('[sharedKey] 利用回数の記録に失敗しました', updateError.message)
}
