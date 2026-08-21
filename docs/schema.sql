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
--   4. 本番との差分 — pg_policies と突き合わせて見つかった未整理（要判断）


-- ############################################################################
-- 1. テーブル
--
-- フロントは anon key + ユーザーのJWTで直接テーブルを叩き（src/lib/supabase.ts）、
-- バックエンドの service_role は RLS を完全にバイパスする（backend/supabaseAdmin.ts）。
-- ＝ 以下のポリシーが縛るのは「フロントからの直接アクセス」だけ。
--
-- ポリシー名と条件は本番の pg_policies に合わせてある（2026-08-19 突き合わせ）。
-- update に with check を書いていないのも本番どおりで、省くと Postgres が using を
-- 検査にも流用する（自分の会話の行を他人の会話へ付け替える、が塞がる）。
-- ただし対象ロールは未確認のため、この文書では authenticated としている[要確認]。
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

create policy user_setting_select_own on public.user_setting for select
  to authenticated using (auth.uid() = id);

create policy user_setting_insert_own on public.user_setting for insert
  to authenticated with check (auth.uid() = id);

create policy user_setting_update_own on public.user_setting for update
  to authenticated using (auth.uid() = id);

-- 退会は service_role が行う（auth.users を消せるのが service_role だけのため。
-- backend/routes/account.ts）。フロントから自分の行を消す経路は無いが、本番には有る
create policy user_setting_delete_own on public.user_setting for delete
  to authenticated using (auth.uid() = id);

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

create policy conversations_select_own on public.conversations for select
  to authenticated using (auth.uid() = user_id);

create policy conversations_insert_own on public.conversations for insert
  to authenticated with check (auth.uid() = user_id);

create policy conversations_update_own on public.conversations for update
  to authenticated using (auth.uid() = user_id);

create policy conversations_delete_own on public.conversations for delete
  to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- messages — 発言。所有者判定は親の conversations 経由
--
-- content は content_blocks.payload.content と同じ本文を持つ2つ目の写し。アプリは
-- 書くだけで読まない（fetchMessages の select に content は無く、本文の読み出しは
-- content_blocks の join だけ）。
--
-- 【削除しない】長らく「実質使われていない削除候補」としていたが、2026-08-19 に
-- 撤回した。読まれないことは無用であることを意味しない。この列は
-- 「独立した2つ目の写し」であること自体が役割で、実際に2つの障害をこれで捕まえた。
--
--   1. content_blocks への insert が 22P02 で全滅したとき、本文が残っていたのは
--      この列だけだった（＝中断がどこで起きたかを事後に特定できた）
--   2. content と content_blocks を突き合わせて 4文字のずれを検出した。
--      persistMessage が message.blocks を await を跨いで2回読んでおり、その間に
--      届いたトークンぶん食い違っていた（修正済み。useChat.ts の insertBlockRows 付近）
--
-- 写しが1つしか無ければ、2つの値のどちらが正しいかを問う機会すら生まれない。
-- 95行で 55 kB。検知能力に対して保持コストが安すぎるため、消さずに持ち続ける。
--
-- 【既知のずれ】dd48812c-94dd-4df9-a612-5c144d188fdf は content 256文字 /
-- content_blocks 252文字のまま放置している（上の修正より前に書かれた中断応答）。
-- 表示は252文字ぶんで、実害は末尾4文字が読めないことだけ。
--
-- 【突き合わせクエリ】only_in_content と diverged が 0 なら健全
--   with joined as (
--     select m.id, m.content as msg_content,
--       coalesce((select string_agg(b.payload->>'content', '' order by b.sort_order)
--                 from public.content_blocks b
--                where b.message_id = m.id and b.type = 'text'), '') as block_content
--     from public.messages m
--   )
--   select count(*) as total,
--          count(*) filter (where msg_content <> block_content) as diverged,
--          count(*) filter (where block_content = '' and msg_content <> '') as only_in_content
--     from joined;
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

create policy messages_select_own on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

create policy messages_insert_own on public.messages for insert
  to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

-- 途中保存と言い直しで本文を書き換える（useChat.ts の updatePersistedMessage）ため必要
create policy messages_update_own on public.messages for update
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

create policy messages_delete_own on public.messages for delete
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));

-- 共有されたターンだけを、未ログインの閲覧者へ開ける（ROADMAP ③）。
-- 起点は shared_messages で、そこに生きている行が無いメッセージは anon から見えない。
-- ＝ 共有していないメッセージのIDを直接叩いても0件になる。
-- 対象に authenticated も含めるのは、ログイン済みの人が「他人の」共有URLを開くため
-- （messages_select_own は自分の会話しか通さない）
create policy messages_select_shared on public.messages for select
  to anon, authenticated
  using (exists (
    select 1 from public.shared_messages s
    where s.revoked_at is null
      and (s.message_id = messages.id or s.question_message_id = messages.id)
  ));

-- signals は「停止した・言い直した」というユーザーの操作の記録で、共有の対象ではない。
-- 行ポリシーとは独立した列単位の防御として、閲覧者からは読めなくする
revoke select (signals) on public.messages from anon;

-- ----------------------------------------------------------------------------
-- content_blocks — 本文の正本。所有者判定は message → conversation 経由
--
-- 永続化するのは 'text' と 'perspective'。
--
-- 'perspective'（三体モードの副体の見解）は当初「表示専用の一時ブロック」として捨てて
-- いたが、リロードで「どの体が何と言ったか」が消えるため保存に切り替えた（2026-08-19）。
-- 3つの知性が同じ問いで割れる瞬間は ThreeBody が文脈なしに見て分かる唯一の出力であり
-- （ROADMAP 0章）、共有カード（ROADMAP ③）もこのデータが正本になる。
-- payload は { bodies: [{ bodyIndex, name, provider, content, done }] }。
--
-- 'error' だけは今も保存しない。表示専用の一時情報で、残す価値が無い
-- ----------------------------------------------------------------------------
-- 型名も値も、本ファイルは長らく間違っていた（2026-08-19 に pg_enum と突き合わせて訂正）。
-- 型名は content_block_type ではなく block_type、値も 'text' だけではなかった。
-- 冒頭の【出所】のとおり本ファイルは pg_dump ではなくクエリからの再構築であり、
-- 型名と enum の値はアプリのクエリには現れないため、推測が2つとも外れていた。
--
-- voice / image / map / game はアプリが一度も書かず、読む側も無い（BlockRow の型は
-- 'text' | 'perspective' の2値。useChat.ts）。過去の設計の名残と見られる。
-- Postgres では enum の値を落とすのに型の作り直しと列の張り替えが要るため、
-- 消さずに残したまま使わない
create type public.block_type as enum ('text', 'voice', 'image', 'map', 'game', 'perspective');

create table public.content_blocks (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages (id) on delete cascade,
  type        public.block_type not null default 'text',
  payload     jsonb not null,
  sort_order  integer not null default 0
);

create index content_blocks_message_id_sort_order_idx
  on public.content_blocks (message_id, sort_order);

alter table public.content_blocks enable row level security;

create policy content_blocks_select_own on public.content_blocks for select
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

create policy content_blocks_insert_own on public.content_blocks for insert
  to authenticated
  with check (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

-- アプリは update を使わない（書き換えは「全削除 → 入れ直し」。useChat.ts）が、
-- 本番には存在するので合わせてある
create policy content_blocks_update_own on public.content_blocks for update
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

create policy content_blocks_delete_own on public.content_blocks for delete
  to authenticated
  using (exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = content_blocks.message_id and c.user_id = auth.uid()
  ));

-- 共有されたターンの本文と検算カード。条件は messages_select_shared と同型で、
-- 起点も同じ shared_messages（＝取り消せば両方が同時に閉じる）
create policy content_blocks_select_shared on public.content_blocks for select
  to anon, authenticated
  using (exists (
    select 1 from public.shared_messages s
    where s.revoked_at is null
      and (s.message_id = content_blocks.message_id or s.question_message_id = content_blocks.message_id)
  ));

-- ----------------------------------------------------------------------------
-- shared_messages — 公開したターンの台帳（ROADMAP ③ 見解の共有）
--
-- 【何を公開するか】1ターン ＝ 主体の答え（message_id）＋ その問い
-- （question_message_id）。検算カードは答えの content_blocks に 'perspective' として
-- 入っているので、行を足す必要は無い。
--
-- 【なぜ台帳を別テーブルにするか】
--   1. URLに出るのは token で、message_id ではない。message_id はアプリ内の他の
--      文脈（エラー報告のcontext等）にも出るIDなので、それがそのまま公開URLだと
--      「共有していないものが漏れた」と「共有したものが読まれた」を区別できない
--   2. 取り消せる。revoked_at を立てれば全ポリシーが同時に閉じる
--   3. 会話は私物という既定を崩さない。既定は非公開で、行がある1件だけが公開になる
--
-- 【閲覧のコスト】anon key でフロントから直接読む。閲覧者はLLMを呼ばず、
-- 自前サーバーも通らない。何人見ても無料枠が1回も減らないことが③の存在理由
-- （ROADMAP 2章「律速は資金」を迂回する唯一の経路）。
--
-- 生きている共有は1メッセージにつき1件（部分ユニーク）。取り消した行は履歴として残り、
-- 再共有すると新しい token が発行される＝古いURLは復活しない
-- ----------------------------------------------------------------------------
create table public.shared_messages (
  token                uuid primary key default gen_random_uuid(),
  message_id           uuid not null references public.messages (id) on delete cascade,
  question_message_id  uuid references public.messages (id) on delete set null,
  user_id              uuid not null references public.user_setting (id) on delete cascade,
  created_at           timestamptz not null default now(),
  revoked_at           timestamptz
);

comment on table public.shared_messages is
  '公開したターンの台帳。token が公開URL、message_id が主体の答え、question_message_id がその問い。revoked_at で取り消す。';

create unique index shared_messages_live_message_idx
  on public.shared_messages (message_id) where revoked_at is null;

-- usewr_idは重複はしないから、unique indexを作成する必要はない。
create index shared_messages_user_id_idx on public.shared_messages (user_id);

alter table public.shared_messages enable row level security;

-- 未ログインの閲覧者。token を知っている行だけが実際に取れる（絞り込みは
-- クエリ側の .eq('token', …)）。ポリシー自体は「生きている共有かどうか」しか見ない
create policy shared_messages_select_public on public.shared_messages for select
  to anon, authenticated using (revoked_at is null);

-- 取り消した自分の共有も、所有者は見える（共有中かどうかの表示に使う）
create policy shared_messages_select_own on public.shared_messages for select
  to authenticated using (auth.uid() = user_id);

-- 自分のメッセージしか公開できない。user_id の自称だけでは足りず、
-- そのメッセージが自分の会話に属することまで確かめる
create policy shared_messages_insert_own on public.shared_messages for insert
  to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = shared_messages.message_id and c.user_id = auth.uid()
    )
  );

-- 取り消し（revoked_at を立てる）に必要
create policy shared_messages_update_own on public.shared_messages for update
  to authenticated with check (auth.uid() = user_id);

create policy shared_messages_delete_own on public.shared_messages for delete
  to authenticated using (auth.uid() = user_id);

-- 誰が共有したかは公開しない（ROADMAP ③「ユーザープロフィールは作らない」）。
-- 行ポリシーとは独立した列単位の防御で、user_id は閲覧者から読めなくする
revoke select (user_id) on public.shared_messages from anon;

-- ----------------------------------------------------------------------------
-- feedback — エラー報告（src/composables/useFeedback.ts）
--
-- 書き込み専用で、閲覧・集計手段はアプリ側に未実装（運営が Supabase 側で直接見る）。
-- ポリシーも insert 1つだけ。＝ 投稿者本人であっても自分の報告を読み返せない。
-- 名前だけ他と揃っていない（"insert own feedback"）が、本番の実態に合わせてある
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

create policy "insert own feedback" on public.feedback for insert
  to authenticated with check (auth.uid() = user_id);


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
--   6. 未使用テーブルの削除（2026-08-19）
--        drop table face_descriptors / intents_log。どちらもアプリからの参照が無く、
--        行数も0だった。face_descriptors は顔認識の試作、intents_log は I0 の先行案が
--        残ったものと見られる。列定義は控えを取る前に落としたため残っていない
--        （0行・未参照のため、記録として惜しむ内容は無いと判断した）
--   7. 重複ポリシーの削除（2026-08-19）
--        drop policy user_setting_self / messages_owner / content_blocks_owner。
--        いずれも cmd = ALL で、各テーブルに揃っている *_select_own 等4つと条件が
--        等価だった（in と exists の書き方違いのみ）。permissive ポリシーは OR で
--        評価されるため許可範囲は変わらず、「個別を直したのに ALL が残っていて効かない」
--        という事故の種だけが減る。削除後に select / insert / update / delete を
--        画面から一度ずつ通して確認済み。
--        ＝ 以降、messages と content_blocks と user_setting の許可範囲は
--        章1に書いてある個別ポリシーだけが決めている
--   8. 見解の永続化（2026-08-19）
--        alter type public.block_type add value if not exists 'perspective'。
--        既存行に触れないのでロックもバックフィルも不要で、過去の行は 'text' のまま。
--        遡って見解が埋まることはなく、適用後に生成されたターンからだけ残る。
--        適用前は 22P02 で content_blocks への insert が失敗しており、本文と見解を
--        1つの配列で送っていたため本文まで巻き添えで落ちていた（応答が画面から丸ごと
--        消え、直前の質問が孤立表示になる）。insert は本文と見解に分離済み
--        （useChat.ts の insertBlockRows）
--   9. 見解の共有（2026-08-21）※本番未適用
--        create table shared_messages + 部分ユニークindex + ポリシー5本、
--        messages / content_blocks に *_select_shared（to anon, authenticated）を1本ずつ、
--        revoke select (user_id) on shared_messages / (signals) on messages from anon。
--        これが RLS を anon へ開ける最初の変更なので、適用後に必ず確認すること:
--        共有していない message_id を anon key で直接 select して0件になること
--        （scripts/verify-share-rls.mjs が両方向を確かめる）
--
-- 【確認クエリ】SQL Editor のタブは使い捨てにし、これらだけ手元に残しておけばよい。
--   select can_use_shared_key, count(*) from public.user_setting group by 1;
--   select policyname, cmd from pg_policies where schemaname = 'public' order by tablename, cmd;
--   -- 全体上限の疎通確認（実運用日に触れないよう過去日で試し、最後に消す）
--   select public.try_reserve_global_quota(date '1999-01-01', 10);  -- count = 1
--   select public.release_global_quota(date '1999-01-01');          -- count = 0
--   delete from public.shared_key_global_usage where day = date '1999-01-01';
-- ############################################################################


-- ############################################################################
-- 4. 本番との差分 — 未整理（2026-08-19、pg_policies との突き合わせで判明）
--
-- 章1〜3 は本番に合わせて直してある。ここに残すのは「本番にあるが、消すか残すかを
-- まだ決めていないもの」。決めたら実行し、この節から消して章1〜3 に反映する。
-- ############################################################################

-- ----------------------------------------------------------------------------
-- 4-1. feedback に select ポリシーが無い
--
-- 本番のポリシーは "insert own feedback"（INSERT）1つだけ。投稿者本人も自分の報告を
-- 読み返せない。書き込み専用と割り切るならこのままでよいが、アプリに履歴表示を
-- 付けるなら下を足す。付けないなら、この節ごと消してよい
--   create policy feedback_select_own on public.feedback for select
--     to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4-2. block_type の未使用値（voice / image / map / game）
--
-- アプリは一度も書かず、読む側も無い（BlockRow は 'text' | 'perspective' の2値）。
-- 消すには型を作り直して content_blocks.type を張り替える必要があり、稼働中のテーブル
-- に対してその手間を払う理由が今は無い。残す判断でよければ、この節ごと消してよい。
--
-- 【確認クエリ】
--   select enumlabel from pg_enum e
--     join pg_type t on t.oid = e.enumtypid
--    where t.typname = 'block_type' order by e.enumsortorder;
--   select type, count(*) from public.content_blocks group by 1;
