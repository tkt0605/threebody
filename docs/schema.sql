-- ThreeBody — Supabase (Postgres) スキーマ
--
-- 【このファイルが正本】Supabase SQL Editor で直接叩いて終わりにせず、必ずここへ
-- 書いてから適用する。過去にこの運用が崩れ、docs/shared-key-migration.sql という
-- 「コードから参照されるのに実体が一度も存在しないファイル」が生まれている
-- （backend/supabaseAdmin.ts:6）。
--
-- 【出所】pg_dump の出力ではなく、アプリが実際に発行しているクエリから再構築したもの
-- （直接接続ホストが IPv6 専用でこの開発環境から到達できない）。NULL 許容・既定値の
-- 細部・追加インデックス・トリガーは本番と差分がありうる。一度 Connection Pooling
-- 経由で dump して突き合わせ、正本化するのが望ましい:
--   npx supabase db dump --db-url "postgresql://postgres.<ref>:<pw>@<pooler-host>:5432/postgres" \
--     --schema public -f docs/schema.sql.actual
--
-- 【構成】
--   1. テーブル — 定義・index・RLSポリシーをテーブルごとにまとめる
--   2. 関数（RPC） — 共有キーのクォータ操作。service_role からのみ呼ぶ
--   3. 適用履歴 — 本番へ流し終えた変更の一覧


-- ############################################################################
-- 1. テーブル
--
-- フロントは anon key + ユーザーのJWTで直接テーブルを叩き（src/lib/supabase.ts）、
-- バックエンドの service_role は RLS を完全にバイパスする（backend/supabaseAdmin.ts）。
-- ＝ 以下のポリシーが縛るのは「フロントからの直接アクセス」だけ。
--
-- 依存の都合で、この順序のまま上から実行すること
-- （user_setting → conversations → messages → content_blocks / feedback）。
-- ############################################################################

-- ----------------------------------------------------------------------------
-- user_setting — プロフィール兼、共有APIキーの日次クォータ
--
-- id は auth.users.id と同一（Supabase Auth のIDをそのまま主キーにする定番の形）。
-- conversations.user_id / feedback.user_id がこれを参照するので、会話を作る前に
-- ensureUserProfile() で行を用意しておく必要がある（src/composables/useChat.ts）。
-- ----------------------------------------------------------------------------
create table public.user_setting (
  id                     uuid primary key references auth.users (id) on delete cascade,

  -- 共有APIキー（運営負担の無料お試し枠）。書けるのは service_role だけで、その実効
  -- 手段は下の revoke。既定 true のブロックリスト方式なので、false は「まだ招待して
  -- いない」ではなく「運営が明示的に停止した」を意味する。
  -- 運営の総額を守るのはこの列ではなく shared_key_global_usage の全体上限
  can_use_shared_key     boolean not null default true,
  shared_daily_count     integer not null default 0,
  shared_last_used_date  date,  -- JST暦日を 'YYYY-MM-DD' で保持（backend/utils/jstDate.ts）

  created_at             timestamptz not null default now()
);

comment on table public.user_setting is
  'ユーザープロフィール兼、共有APIキーの日次クォータ。id は auth.users.id と同一。';
comment on column public.user_setting.can_use_shared_key is
  '共有キーの利用可否。既定 true（ブロックリスト方式）。false は「運営が明示的に停止した」を意味する。';

alter table public.user_setting enable row level security;

create policy "user_setting: select own" on public.user_setting for select
  to authenticated using (id = auth.uid());

create policy "user_setting: insert own" on public.user_setting for insert
  to authenticated with check (id = auth.uid());

create policy "user_setting: update own" on public.user_setting for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 行ポリシーとは独立した列単位の防御。これが無いと、update own を根拠に
-- 自分の can_use_shared_key を自称 true へ書き換えられてしまう
revoke update (can_use_shared_key, shared_daily_count, shared_last_used_date)
  on public.user_setting from authenticated;

-- ----------------------------------------------------------------------------
-- shared_key_global_usage — 共有キーの全ユーザー合計・日次消費（総額キルスイッチ）
--
-- user_setting.shared_daily_count がユーザー単位、こちらは1日1行のグローバルカウンタ。
-- 行は try_reserve_global_quota が upsert で自己生成するので、あらかじめ作らない。
-- ポリシーを1つも置かない＝フロントからは実質アクセス不可（service_role のみ）。
-- ----------------------------------------------------------------------------
create table public.shared_key_global_usage (
  day    date primary key,
  count  integer not null default 0
);

comment on table public.shared_key_global_usage is
  '共有キーの全ユーザー合計・日次消費カウンタ（Phase 1のキルスイッチ用）。dayはJST暦日。';

alter table public.shared_key_global_usage enable row level security;

-- ----------------------------------------------------------------------------
-- conversations — 会話。1ユーザーが複数持てる（サイドバーの会話一覧）
-- ----------------------------------------------------------------------------
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_setting (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index conversations_user_id_updated_at_idx
  on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;

create policy "conversations: select own" on public.conversations for select
  to authenticated using (user_id = auth.uid());

create policy "conversations: insert own" on public.conversations for insert
  to authenticated with check (user_id = auth.uid());

create policy "conversations: update own" on public.conversations for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "conversations: delete own" on public.conversations for delete
  to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- messages — 発言。所有者判定は親の conversations 経由
--
-- content は content_blocks.payload.content との二重管理。insert / update では
-- 書いているが select には一度も現れず（本文の読み出しは content_blocks を join する
-- fetchMessages だけ）、実質使われていない。削除候補だが今は残してある。
--
-- signals は I0（記録）で足した列。停止・言い直し・再質問といった「推論を挟まずに
-- 観測できた事実」を持つ（src/types/intent.ts の TurnSignals）。表示物ではなく
-- メタデータなので content_blocks ではなくここに置く。立っていなければ null のまま
-- （＝「何も起きなかった」と「まだ記録していない」を区別できる）。
-- modality は入力経路。signals とは寿命も意味も違うため同居させず独立した列にする
-- ----------------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  signals          jsonb,
  modality         text not null default 'text' check (modality in ('text', 'voice')),
  "timestamp"      timestamptz not null default now()
);

create index messages_conversation_id_timestamp_idx
  on public.messages (conversation_id, "timestamp");

alter table public.messages enable row level security;

create policy "messages: select own" on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

create policy "messages: insert own" on public.messages for insert
  to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

create policy "messages: delete own" on public.messages for delete
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

-- [要判断] update ポリシーがここに無い。アプリは messages を更新している
--   （useChat.ts の updatePersistedMessage＝途中保存と言い直し、pruneOrphanedMessages の
--   signals 書き換え）。RLS 下で update ポリシーが1つも無ければ更新は0行になるため、
--   本番には別途 update ポリシーが存在するはずで、このファイルの取りこぼしと思われる。
--   本番を確認し、あれば下に書き足す:
--     select policyname, cmd from pg_policies where tablename = 'messages';

-- ----------------------------------------------------------------------------
-- content_blocks — 本文の正本。所有者判定は message → conversation 経由
--
-- 永続化するのは 'text' だけ。'error'（エラー表示）と 'perspective'（三体モードの
-- 副体リアルタイム表示）はフロントの型（src/types/message.ts）にはあるがDBには
-- 意図的に保存しない一時ブロック。将来ブロック種別を増やすなら enum もここで広げる
-- ----------------------------------------------------------------------------
create type public.content_block_type as enum ('text');

create table public.content_blocks (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages (id) on delete cascade,
  type        public.content_block_type not null default 'text',
  payload     jsonb not null,
  sort_order  integer not null default 0
);

create index content_blocks_message_id_sort_order_idx
  on public.content_blocks (message_id, sort_order);

alter table public.content_blocks enable row level security;

-- 更新ポリシーは意図的に無い。書き換えは「全削除 → 入れ直し」で行う（useChat.ts）
create policy "content_blocks: select own" on public.content_blocks for select
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

create policy "content_blocks: insert own" on public.content_blocks for insert
  to authenticated
  with check (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

create policy "content_blocks: delete own" on public.content_blocks for delete
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

-- ----------------------------------------------------------------------------
-- feedback — エラー報告（src/composables/useFeedback.ts）
--
-- 書き込み専用で、閲覧・集計手段はアプリ側に未実装（運営が Supabase 側で直接見る）。
-- そのため select は自分の投稿を読み返せる範囲に留め、他人の報告は見せない
-- ----------------------------------------------------------------------------
create table public.feedback (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.user_setting (id) on delete cascade,
  conversation_id  uuid references public.conversations (id) on delete set null,
  kind             text not null default 'error_report',
  comment          text,
  error_raw        text,
  error_display    text,
  context          jsonb,
  created_at       timestamptz not null default now()
);

create index feedback_user_id_idx on public.feedback (user_id);

alter table public.feedback enable row level security;

create policy "feedback: insert own" on public.feedback for insert
  to authenticated with check (user_id = auth.uid());

create policy "feedback: select own" on public.feedback for select
  to authenticated using (user_id = auth.uid());


-- ############################################################################
-- 2. 関数（RPC）
--
-- いずれも共有キーのクォータ操作。backend/sharedKey.ts からのみ呼ばれ、
-- authenticated には EXECUTE を渡さない（＝フロントから直接は呼べない）。
--
-- 【全体の設計】枠の消費は「個人枠（consume_shared_quota）」と
-- 「全体枠（try_reserve_global_quota / release_global_quota）」の二段構え。
-- どちらも数えるのは "実際に提供できたターン" で、失敗した分は枠を食わせない
-- （プロバイダー障害の日に無料枠が誰にも届かないまま尽きるのを避けるため）。
-- ############################################################################

-- 個人枠の加算。日付が変わっていれば 1 にリセットする。
--
-- 【なぜ単一UPDATEか】read-then-write にすると、同時リクエストが同じ更新前の値を読み、
-- 片方の加算が消える。1文にすることで Postgres の行ロックが直列化してくれる。
--
-- 【既知の残課題】この関数は上限を見ない。上限判定は応答開始前の peekSharedAllowance が
-- 行い、ここは応答完了後に加算するだけなので、その間（＝LLM応答の長い時間）に同一
-- ユーザーが同時リクエストを投げると、両方が「まだ上限内」と判定されて日次上限を数回
-- 超過しうる。カウントが壊れるのではなく「超えて許可してしまう」方向のリスク。
-- 防ぐには応答前の原子的な予約に変える必要があり、呼び出し側の変更を伴うため未着手
create or replace function public.consume_shared_quota(p_user_id uuid, p_today date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_setting
  set
    shared_daily_count    = case when shared_last_used_date = p_today
                                 then coalesce(shared_daily_count, 0) + 1
                                 else 1
                            end,
    shared_last_used_date = p_today
  where id = p_user_id;
$$;

revoke all on function public.consume_shared_quota(uuid, date) from public;
grant execute on function public.consume_shared_quota(uuid, date) to service_role;

-- 全体枠の予約。加算した結果が上限内なら true。
--
-- 全体上限は運営の総額を守る最後の砦なので、consume_shared_quota が抱えるレースを
-- 持ち込みたくない。insert ... on conflict ... returning の1文で「加算」と「加算後の
-- 値の取得」を原子化し、先に予約してから閾値と比べる。上限に達した瞬間の数回は
-- 「予約はしたが不許可」という数えられ方になるが、これは意図した安全側の誤差
create or replace function public.try_reserve_global_quota(p_today date, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.shared_key_global_usage (day, count)
  values (p_today, 1)
  on conflict (day) do update
    set count = shared_key_global_usage.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.try_reserve_global_quota(date, integer) from public;
grant execute on function public.try_reserve_global_quota(date, integer) to service_role;

-- 予約の取り消し。予約したのに応答を提供できなかったとき（プロバイダーのエラー、
-- ユーザーの中断）だけ、backend/routes/chat.ts の finally が呼ぶ。
--
-- greatest(count - 1, 0) で負に落ちない。二重解放や日跨ぎの解放でもカウンタは壊れず、
-- 最悪でも翌日の枠が1つ多くなるだけで上限そのものは破れない
create or replace function public.release_global_quota(p_today date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shared_key_global_usage
  set count = greatest(count - 1, 0)
  where day = p_today;
$$;

revoke all on function public.release_global_quota(date) from public;
grant execute on function public.release_global_quota(date) to service_role;


-- ############################################################################
-- 3. 適用履歴
--
-- 章1〜2 は「新規に作る場合」の完成形であり、そのまま上から流せば本番と同じ形になる。
-- 稼働中の本番には以下を適用済みで、再実行は不要。
-- 今後の変更は、章1〜2 の本体を直したうえでこの一覧に1行足すこと
-- （かつては適用用のSQLを丸ごと再掲していたが、本体と重複して二重管理になっていた）。
--
--   1. 共有キーの日次クォータ
--        user_setting の3列 + consume_shared_quota
--   2. 全体上限のキルスイッチ（Phase 1 Step 2）
--        shared_key_global_usage + try_reserve_global_quota
--   3. 招待制の反転（Phase 1 Step 3）※一度きり
--        can_use_shared_key を default true にし、既存行を true でバックフィル。
--        適用前の false は全て「まだ招待していない」の意味だったため一律 true にできたが、
--        適用後の false は「明示的に停止した」に変わっている。もう一度流すと
--        停止したアカウントを復活させてしまうので、二度と実行しないこと
--   4. 予約の解放
--        release_global_quota
--   5. 意図シグナル（I0 記録）
--        messages.signals / messages.modality + messages_modality_check
--
-- 【確認クエリ】SQL Editor のタブは使い捨てにし、これらだけ手元に残しておけばよい。
--   select can_use_shared_key, count(*) from public.user_setting group by 1;
--   select policyname, cmd from pg_policies where schemaname = 'public' order by tablename, cmd;
--   -- 全体上限の疎通確認（実運用日に触れないよう過去日で試し、最後に消す）
--   select public.try_reserve_global_quota(date '1999-01-01', 10);  -- count = 1
--   select public.release_global_quota(date '1999-01-01');          -- count = 0
--   delete from public.shared_key_global_usage where day = date '1999-01-01';
-- ############################################################################
