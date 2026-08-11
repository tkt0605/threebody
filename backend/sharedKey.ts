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

// limit_reached（そのユーザーが今日使い切った）と global_limit_reached（運営の
// 全体枠が今日尽きた）は必ず区別する。前者は「あなたが使った」、後者は「あなたのせいでは
// ない」であり、案内すべき次の行動も違う（前者=自分のキーを登録 or 明日、
// 後者=時間をおくか自分のキーを登録）。同じ値にまとめると、1回も使っていない
// ユーザーに「今日の無料利用は3回までです」と表示してしまう
export type SharedAllowance =
  | { allowed: true;  remaining: number }
  | {
      allowed: false
      reason: 'unavailable' | 'not_signed_in' | 'not_permitted' | 'limit_reached' | 'global_limit_reached'
    }

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

// 今日の全体消費数を「読むだけ」で取得する（予約はしない）。
// 表示用の peek が全体枠の状態を知るための経路。try_reserve_global_quota を呼ぶと
// 見ただけで枠が減るため、こちらは単純な select にしてある。
//
// 行が無い＝今日はまだ誰も使っていないので 0。読めなかった場合は null を返し、
// 呼び出し側は「不明」として表示を楽観側に倒す（実際に止めるのは予約側の責任で、
// 表示の一時的な失敗でユーザーに「使えません」と誤って伝えないため）
async function readGlobalUsage(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin
    .from('shared_key_global_usage')
    .select('count')
    .eq('day', jstDateString())
    .maybeSingle<{ count: number | null }>()

  if (error) {
    console.warn('[sharedKey] 全体消費数の取得に失敗しました（表示のみ影響）', error.message)
    return null
  }
  return data?.count ?? 0
}

// 判定の内訳をターミナルに出す。
// SharedAllowance.reason は同じ値でも原因が複数あるため
// （not_permitted = 明示的に停止 or 行の取得失敗）、reason だけでは切り分けができない。
// 運用時に「誰がなぜ弾かれたか」を追えるようにする
function logDecision(userId: string | null, detail: string): void {
  console.info(`[sharedKey] ${detail}${userId ? ` user=${userId}` : ''}`)
}

// 判定だけを行い、全体枠は消費しない。「あと何回使えるか」を表示するだけの経路
// （GET /api/capabilities）はこちらを呼ぶこと。
//
// 表示用の経路が全体枠を減らすと、ページを開き直すたびにキルスイッチが目減りし、
// LLMを一度も呼ばないまま全体上限に到達しうる。副作用の有無で関数名を分け、
// 呼び分けを型レベルで強制する（両者を1つの関数にすると必ずどちらかを取り違える）
export async function peekSharedAllowance(userId: string | null): Promise<SharedAllowance> {
  if (!sharedApiKey()) {
    logDecision(null, 'SHARED_ANTHROPIC_API_KEY が未設定のため使用せず')
    return { allowed: false, reason: 'unavailable' }
  }
  if (!userId) {
    logDecision(null, '未ログインのため使用せず')
    return { allowed: false, reason: 'not_signed_in' }
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    logDecision(userId, 'Supabase未設定のため使用せず')
    return { allowed: false, reason: 'unavailable' }
  }

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
  // 判断できないときに使わせる側へ倒すと、運営のキーが無制限に使われうる。
  // これは仕様どおりの拒否ではなく異常なので warn で出す（下の停止中アカウントとは別物）
  if (error || !data) {
    console.warn(`[sharedKey] user_setting の行を取得できませんでした user=${userId}`, error?.message ?? '(行が無く、自動作成にも失敗)')
    return { allowed: false, reason: 'not_permitted' }
  }
  // Phase 1 で既定を true に反転したため、ここに来るのは運営が明示的に停止したアカウントだけ
  if (!data.can_use_shared_key) {
    logDecision(userId, '停止中のアカウント（can_use_shared_key=false）')
    return { allowed: false, reason: 'not_permitted' }
  }

  const used = usedToday(data, jstDateString())
  if (used >= SHARED_DAILY_LIMIT) {
    logDecision(userId, `個人の1日上限に到達（${used}/${SHARED_DAILY_LIMIT}回）`)
    return { allowed: false, reason: 'limit_reached' }
  }

  // 全体枠の確認は個人枠の後。両方尽きている場合は個人枠を優先して伝える
  // （そのユーザーにとっては「自分が使い切った」ほうが事実として近く、案内も明確なため）。
  // ここは読むだけなので、予約側（reserveSharedAllowance）とは違いカウンタを動かさない
  const globalUsed = await readGlobalUsage(admin)
  if (globalUsed !== null && globalUsed >= GLOBAL_SHARED_DAILY_LIMIT) {
    logDecision(userId, `全体の1日上限に到達（${globalUsed}/${GLOBAL_SHARED_DAILY_LIMIT}回）`)
    return { allowed: false, reason: 'global_limit_reached' }
  }

  // 成功時はここでログを出さない。この関数は表示用の GET /api/capabilities からも
  // 呼ばれ、ページを開くたびに「許可」が1行増えてしまう。許可の記録は実際にLLMを
  // 呼ぶ reserveSharedAllowance 側に置き、ログ1行＝1ターンの対応を保つ
  return { allowed: true, remaining: SHARED_DAILY_LIMIT - used }
}

// 判定に加えて、全体枠を1つ予約する。実際にLLMを呼ぶ経路（POST /api/chat）だけが呼ぶこと。
//
// 全体上限の予約は個人の判定をすべて通過した最後に行う。これより前で予約すると、
// not_signed_in/not_permitted等どのみち不許可になるリクエストにまで
// 全体枠を消費してしまい、キルスイッチの意味が薄れる
export async function reserveSharedAllowance(userId: string | null): Promise<SharedAllowance> {
  const allowance = await peekSharedAllowance(userId)
  if (!allowance.allowed) return allowance

  // peek が allowed を返した時点で admin は必ず取得できているが、型の上では
  // null を排除できない。getSupabaseAdmin はキャッシュ済みなので取り直しは安い
  const admin = getSupabaseAdmin()
  if (!admin) return { allowed: false, reason: 'unavailable' }

  // peek の select をすり抜けた分（読んだ後・予約する前に他のリクエストが枠を取った）は
  // ここで確実に止まる。判定の正本は常にこちらのRPC側
  if (!(await reserveGlobalQuota(admin))) {
    logDecision(userId, `全体の1日上限に到達（上限${GLOBAL_SHARED_DAILY_LIMIT}回/日）`)
    return { allowed: false, reason: 'global_limit_reached' }
  }

  const used = SHARED_DAILY_LIMIT - allowance.remaining
  logDecision(userId, `許可（本日${used}回使用済み・残り${allowance.remaining}/${SHARED_DAILY_LIMIT}回）`)
  return allowance
}

// 予約した全体枠を1つ返す。呼ぶのは「予約したが応答を提供できなかった」ときだけ。
//
// 全体上限が縛りたいのは「実際に提供できたターン数」なので、プロバイダーのエラーや
// ユーザーの中断で1文字も届かなかった分まで枠を食わせない。個人枠（consumeSharedQuota）が
// 成功時のみ加算しているのと意味を揃える意図でもある。
//
// 【許容している誤差】途中まで出力してから落ちた場合もここで戻すため、トークンを
// 消費した失敗の分だけ全体枠が甘くなる（最大でも失敗した回数ぶん）。上限50回/日に対する
// 影響は小さく、逆に「障害の日に無料枠が誰にも届かないまま尽きる」ほうが損失が大きいと判断した。
// 日跨ぎのタイミングで呼ばれた場合の扱いは docs/schema.sql の release_global_quota を参照
export async function releaseGlobalQuota(): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const { error } = await admin.rpc('release_global_quota', { p_today: jstDateString() })

  // 戻せなくても応答の失敗自体は既にユーザーへ伝わっている。
  // ここで throw しても何も取り消せないので、記録に残して続行する
  if (error) console.error('[sharedKey] 全体枠の解放に失敗しました', error.message)
}

// 消費を1回分記録する。呼ぶのは「共有キーを使い、かつ応答が正常完了した」ときだけ。
//
// DB側の consume_shared_quota（単一UPDATE文、行ロックで直列化）を呼ぶことで原子的に加算する。
// 読んでから書く実装だと、その間に別リクエストが割り込んで同じ値を上書きしうる
// （並列に投げれば上限をすり抜けられる）ため、RPC側に寄せてある
export async function consumeSharedQuota(userId: string): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return

  // 判定（peekSharedAllowance）と保存で計算がずれると日跨ぎで不整合が出るため、
  // ここも必ず jstDateString() を使う
  const { error } = await admin.rpc('consume_shared_quota', {
    p_user_id: userId,
    p_today:   jstDateString(),
  })

  // カウントに失敗しても応答そのものは既に返し終えている。
  // ここで throw しても取り消せないので、記録に残して続行する
  if (error) console.error('[sharedKey] 利用回数の記録に失敗しました', error.message)
}
