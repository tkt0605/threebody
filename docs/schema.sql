-- ThreeBody — Supabase (Postgres) スキーマ
--
-- 【この文書の位置づけ】
-- 本番Supabaseプロジェクトへの直接ダンプ（pg_dump）ではなく、アプリケーションコード
-- （backend/src/*.ts, src/composables/*.ts, src/lib/supabase.ts）が実際に発行している
-- クエリ・RPC呼び出しから再構築したものです。
-- 理由: 直接接続用ホスト（db.<project-ref>.supabase.co:5432）がIPv6専用で、この開発環境
-- からは到達できず、pg_dump による正本の取得ができなかったため（Connection Pooling
-- 経由なら可能）。
--
-- そのため以下は「コードから確実に読み取れる制約」のみを明記し、確認できていない詳細
-- （列のNULL許容・デフォルト値の細部・追加インデックス・トリガーの有無等）は本番と
-- 差分がある前提で扱ってください。一度 Connection Pooling 経由の pg_dump と diff を
-- 取って正本化することを推奨します:
--
--   npx supabase db dump --db-url "postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres" \
--     --schema public -f docs/schema.sql.actual
--
-- 以降の変更は「Supabase SQL Editorで直接叩いて終わり」にせず、必ずこのファイルに
-- 追記してからマイグレーションとして適用してください。過去に一度、この運用が
-- 徹底されず docs/shared-key-migration.sql という「コード内から参照されるが実体は
-- 一度も存在しなかったファイル」が生まれています（backend/src/supabaseAdmin.ts:6 参照）。

-- ============================================================================
-- 1. テーブル
-- ============================================================================

-- ユーザーごとの設定・共有APIキー割当。id は auth.users.id と同一（Supabase Authの
-- ユーザーIDをそのまま主キーにする、プロフィールテーブルの定番パターン）。
-- conversations.user_id / feedback.user_id はこの主キーを参照する
-- （src/composables/useChat.ts:102 のコメントに明記）。
create table public.user_setting (
  id                     uuid primary key references auth.users (id) on delete cascade,

  -- 共有APIキー（運営負担の無料お試し枠）関連。書き込めるのは service_role のみ
  -- （backend/src/sharedKey.ts, backend/src/supabaseAdmin.ts:4-6）。
  -- 招待制のため既定は false（README: 招待制と明記）
  can_use_shared_key     boolean not null default false,
  shared_daily_count     integer not null default 0,
  -- JST暦日を 'YYYY-MM-DD' の date として保持（backend/src/jstDate.ts:23）
  shared_last_used_date  date,

  created_at             timestamptz not null default now()
);
comment on table public.user_setting is
  'ユーザープロフィール兼、共有APIキーの日次クォータ。id は auth.users.id と同一。';
comment on column public.user_setting.can_use_shared_key is
  '共有キーの利用可否。運営がSupabase側で手動更新する招待制（申請UI・管理画面は未実装）。';

-- 会話。1ユーザーが複数持てる（サイドバーの会話一覧）
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_setting (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index conversations_user_id_updated_at_idx
  on public.conversations (user_id, updated_at desc);

-- メッセージ。本文は content にも入るが、実際の読み出しは content_blocks 経由のみ
-- （src/composables/useChat.ts:110-125 の fetchMessages）。
-- content は content_blocks.payload.content と二重管理になっており、どこからも
-- 読まれていない可能性が高い（要確認・見直し候補）
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  "timestamp"      timestamptz not null default now()
);
create index messages_conversation_id_timestamp_idx
  on public.messages (conversation_id, "timestamp");

-- ブロック種別。永続化されるのは 'text' のみ。'error'（エラー表示）と 'perspective'
-- （三体モードの副体リアルタイム表示）はDB非対応の一時ブロックで、フロント側の
-- 型定義（src/types/message.ts）にはあるがDBには意図的に保存しない
-- （src/composables/useChat.ts:285 のコメント）。
-- ※ 実際の型名・値の網羅性は未確認。将来ブロック種別を増やす場合はここも追記すること
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

-- エラー報告（src/composables/useFeedback.ts）。書き込み専用で、閲覧・集計手段は
-- アプリ側に未実装（運営がSupabase側で直接見るしかない）
create table public.feedback (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.user_setting (id) on delete cascade,
  conversation_id   uuid references public.conversations (id) on delete set null,
  kind              text not null default 'error_report',
  comment           text,
  error_raw         text,
  error_display     text,
  context           jsonb,
  created_at        timestamptz not null default now()
);
create index feedback_user_id_idx on public.feedback (user_id);

-- ============================================================================
-- 2. Row Level Security — フロントは anon key + ユーザーのJWTで直接テーブルを叩く
-- （src/lib/supabase.ts）。バックエンドの service_role はRLSを完全にバイパスする
-- （backend/src/supabaseAdmin.ts）ため、以下は「フロントからの直接アクセス」だけを
-- 縛るためのものと理解すること。
-- ============================================================================

alter table public.user_setting   enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.content_blocks enable row level security;
alter table public.feedback       enable row level security;

-- user_setting: 自分の行だけ読み書きできる。
-- ただし共有キー関連3列は下の REVOKE で authenticated から書き込みを取り上げてあるため、
-- ここでの UPDATE 許可があっても実際には can_use_shared_key 等は変更できない
create policy "user_setting: select own"
  on public.user_setting for select
  to authenticated
  using (id = auth.uid());

create policy "user_setting: insert own"
  on public.user_setting for insert
  to authenticated
  with check (id = auth.uid());

create policy "user_setting: update own"
  on public.user_setting for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- conversations: 自分の会話だけ
create policy "conversations: select own"
  on public.conversations for select
  to authenticated
  using (user_id = auth.uid());

create policy "conversations: insert own"
  on public.conversations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "conversations: update own"
  on public.conversations for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "conversations: delete own"
  on public.conversations for delete
  to authenticated
  using (user_id = auth.uid());

-- messages: 自分の会話に属するメッセージだけ（所有者判定は親の conversations 経由）
create policy "messages: select own"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

create policy "messages: insert own"
  on public.messages for insert
  to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

create policy "messages: delete own"
  on public.messages for delete
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

-- content_blocks: 自分のメッセージに属するブロックだけ（所有者判定は message → conversation 経由）
create policy "content_blocks: select own"
  on public.content_blocks for select
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

create policy "content_blocks: insert own"
  on public.content_blocks for insert
  to authenticated
  with check (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

create policy "content_blocks: delete own"
  on public.content_blocks for delete
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

-- feedback: 書き込みは自分の分だけ。閲覧UIが無いため select ポリシーは最小限
-- （自分の投稿を読み返せる程度に留め、他人の報告は見せない）
create policy "feedback: insert own"
  on public.feedback for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "feedback: select own"
  on public.feedback for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- 3. 列GRANT — 共有キーのクォータ列は authenticated から更新不可にする
-- （backend/src/supabaseAdmin.ts:3-6 のコメントに明記された既存の意図をSQLとして
-- 明文化する。RLSの行ポリシーとは独立したレイヤーであり、これが無いと
-- 「自分の行だから」という理由で can_use_shared_key を自称true に書き換えられてしまう）
-- ============================================================================

revoke update (can_use_shared_key, shared_daily_count, shared_last_used_date)
  on public.user_setting from authenticated;

-- ============================================================================
-- 4. RPC — 共有キーの消費を原子的に記録する
-- （backend/src/sharedKey.ts:85-104 が呼ぶ。service_role からのみ呼ばれる想定で、
-- authenticated には EXECUTE を渡さない）
--
-- 【設計】単一UPDATE文にすることで、同一ユーザーへの同時呼び出しをPostgresの行ロックで
-- 直列化する（read-then-writeにすると、2つのリクエストが同じ「更新前の値」を読んで
-- 同じ値を書き込み、片方の加算が消える恐れがある）。日付が変わっていればカウントを
-- 1にリセットする。
--
-- 【既知の残課題・要検討】この関数自体は「上限を超えていないか」を見ない。
-- 上限判定は呼び出し側の checkSharedAllowance（LLM応答の開始前）が行い、この関数は
-- 応答が完了した後に加算するだけ（backend/src/sharedKey.ts:85-89, server.ts の
-- finally 相当）。判定と加算の間にLLM応答という長い時間が挟まるため、同一ユーザーが
-- ほぼ同時に複数リクエストを投げた場合、両方が「まだ上限内」と判定されて通過し、
-- 結果的に日次上限を1〜数回分超過しうる（加算そのものはこの関数により正しく記録される
-- ので、カウントが壊れるわけではなく「上限を超えて許可してしまう」方向のリスク）。
-- 本当に上限突破を防ぐには、LLM応答を始める前に「予約」として原子的に加算し、
-- 失敗（上限超過）なら応答自体を始めない設計に変える必要がある。これは呼び出し側
-- （server.ts）の挙動変更を伴うため、今回は現状の契約を維持したまま明文化のみ行った。
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
