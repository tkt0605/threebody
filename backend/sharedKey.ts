// 共有APIキーのフォールバック。
// APIキーを設定していないユーザーでも、1日数回まで運営のキーで対話を試せるようにする。
//
// 共有キーが存在してよいのは Render の環境変数とこのプロセスのメモリ上だけ。
// DBに入るのは「使ってよいか」と「今日何回使ったか」だけで、キーそのものは入らない。
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from './supabaseAdmin'
import { jstDateString } from './utils/jstDate'

// 1ユーザーあたりの1日の上限。
// Phase 0で単体1回→三体3回分のコストになったため、5→3へ引き下げ
export const SHARED_DAILY_LIMIT = 3

// 全ユーザー合計の1日の上限（Phase 1のキルスイッチ）。
// 招待制を撤廃すると1ユーザー単位の上限だけでは運営の総額を守れないため、
// これとは独立に「サービス全体で1日50回まで」を最後の砦として設ける
export const GLOBAL_SHARED_DAILY_LIMIT = 50

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

// 全体日次上限を原子的に予約する。DB側の try_reserve_global_quota
// （INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING の単一ステートメント）が
// 「加算」と「加算後の値の取得」を1操作にまとめているため、consume_shared_quota側に
// 明記されている既知のTOCTOUレース（判定→応答→加算の間に別リクエストが割り込む）を
// 全体上限では持ち込まない。呼び出しはLLM応答を開始する前（予約）に行う
async function reserveGlobalQuota(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.rpc('try_reserve_global_quota', {
    p_today: jstDateString(),
    p_limit: GLOBAL_SHARED_DAILY_LIMIT,
  })

  // RPC自体が失敗した場合は許可に倒さない（個人枠の判定と同じ安全側の方針）
  if (error) {
    console.error('[sharedKey] 全体上限の予約に失敗しました', error.message)
    return false
  }
  return data === true
}

export async function checkSharedAllowance(userId: string | null): Promise<SharedAllowance> {
  if (!sharedApiKey())  return { allowed: false, reason: 'unavailable'   }
  if (!userId)          return { allowed: false, reason: 'not_signed_in' }

  const admin = getSupabaseAdmin()
  if (!admin) return { allowed: false, reason: 'unavailable' }

  let { data, error } = await admin
    .from('user_setting')
    .select('can_use_shared_key, shared_daily_count, shared_last_used_date')
    .eq('id', userId)
    .maybeSingle<QuotaRow>()

  // 行そのものが無い（クエリ自体は成功、data=null かつ error=null）場合だけ自動作成する。
  // persistMessage経由のプロフィール作成はfire-and-forgetなので、新規ユーザーの初回メッセージで
  // ここが先に読みに来ることがある。バックエンド側でも行を作れるようにし、フロントの
  // タイミングに依存しない形で「行が無いだけで弾かれる」問題を構造的に塞ぐ。
  // payloadはidのみ（can_use_shared_key等はテーブルdefaultに委ねる）。
  // upsertはconflict時もUPDATE（no-op同然）としてRETURNINGされるため、
  // 同時実行で他リクエストが先に作っていてもここで行を取得できる
  if (!data && !error) {
    const created = await admin
      .from('user_setting')
      .upsert({ id: userId })
      .select('can_use_shared_key, shared_daily_count, shared_last_used_date')
      .maybeSingle<QuotaRow>()
    data = created.data
    error = created.error
  }

  // 行が無い・読めない場合は「許可されていない」に倒す。
  // 判断できないときに使わせる側へ倒すと、運営のキーが無制限に使われうる
  if (error || !data) return { allowed: false, reason: 'not_permitted' }
  if (!data.can_use_shared_key) return { allowed: false, reason: 'not_permitted' }

  const used = usedToday(data, jstDateString())
  if (used >= SHARED_DAILY_LIMIT) return { allowed: false, reason: 'limit_reached' }

  // 全体上限の予約は個人の判定をすべて通過した最後に行う。
  // これより前で予約すると、not_signed_in/not_permitted等どのみち不許可になる
  // リクエストにまで全体枠を消費してしまい、キルスイッチの意味が薄れる
  if (!(await reserveGlobalQuota(admin))) return { allowed: false, reason: 'limit_reached' }

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
