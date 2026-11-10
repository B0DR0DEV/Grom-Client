-- Grom Client 1.5.3 — закрываем прямой доступ клиентов к аккаунтам и сообщениям.
--
-- Что было не так: лаунчер ходил в таблицы напрямую с публичным anon-ключом и сам говорил серверу «я — такой-то ник».
-- Из-за этого любой мог:
--   • скачать хеши паролей всех пользователей (accounts.password_hash);
--   • поменять чужой аватар, ник или хеш пароля и войти в чужой аккаунт;
--   • читать, править и удалять чужие личные сообщения и писать от чужого имени.
--
-- Что делает эта миграция:
--   • password_hash больше нельзя прочитать; писать в accounts и direct_messages напрямую нельзя;
--   • все изменения идут через функции, которые проверяют токен сессии (его выдаёт login_account / register_account);
--   • напрямую читать можно только общий чат; личную переписку отдаёт функция только её участникам.
--
-- ⚠ Требует миграцию 20261025_auth_sessions_skins.sql (функции входа и сессии). Выполняй после неё.
-- ⚠ Лаунчеры старше 1.5.3 после этого не смогут писать в чат и менять профиль, а самые старые — входить.
--   Поэтому сразу после миграции выпусти 1.5.3 и включи обязательное обновление (см. конец файла).

-- ───────────────────────── accounts ─────────────────────────
alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;

-- Читать можно все колонки, кроме password_hash.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'accounts' and column_name <> 'password_hash';
  execute format('grant select (%s) on public.accounts to anon, authenticated', cols);
end $$;

-- Если раньше политики RLS не было — без неё никто ничего бы не увидел. Разрешаем чтение публичного профиля.
drop policy if exists grom_accounts_public_read on public.accounts;
create policy grom_accounts_public_read on public.accounts for select to anon, authenticated using (true);

-- Отметиться «в сети» (вместо прежнего upsert, который позволял создавать аккаунты без пароля).
create or replace function public.account_touch(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then return json_build_object('ok', false, 'error', 'Сессия устарела — войди заново'); end if;
  update public.accounts set status = case when status in ('busy', 'away', 'playing') then status else 'online' end where id = acc.id;
  return json_build_object('ok', true);
end $$;

-- Изменить свой профиль: аватар, статус, ник. Пустые параметры не меняются.
create or replace function public.account_update(p_token text, p_avatar_url text default null, p_status text default null, p_nickname text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token); n text := btrim(coalesce(p_nickname, ''));
begin
  if acc.id is null then return json_build_object('ok', false, 'error', 'Сессия устарела — войди заново'); end if;

  if p_avatar_url is not null then
    if p_avatar_url !~ '^https://' or length(p_avatar_url) > 500 then
      return json_build_object('ok', false, 'error', 'Некорректная ссылка на аватар');
    end if;
    update public.accounts set avatar_url = p_avatar_url where id = acc.id;
  end if;

  if p_status is not null then
    if p_status not in ('online', 'away', 'busy', 'playing', 'offline') then
      return json_build_object('ok', false, 'error', 'Неизвестный статус');
    end if;
    update public.accounts set status = p_status where id = acc.id;
  end if;

  if n <> '' and n <> acc.nickname then
    if n !~ '^[A-Za-z0-9_]{3,16}$' then return json_build_object('ok', false, 'error', 'Ник: 3–16 символов, латиница, цифры и _'); end if;
    if exists (select 1 from public.accounts where lower(nickname) = lower(n) and id <> acc.id) then
      return json_build_object('ok', false, 'error', 'Этот ник уже занят');
    end if;
    update public.accounts set nickname = n where id = acc.id;
    -- переписка и скин переезжают вместе с ником
    update public.direct_messages set from_nickname = n where from_nickname = acc.nickname;
    update public.direct_messages set to_nickname = n where to_nickname = acc.nickname;
    update public.direct_messages set reply_to_author = n where reply_to_author = acc.nickname;
    update public.skins set nickname = n where account_id = acc.id::text;
  end if;

  select * into acc from public.accounts where id = acc.id;
  return json_build_object('ok', true, 'account', public._account_json(acc));
end $$;

-- «Играть с другом»: опубликовать или убрать свою активность.
create or replace function public.account_set_activity(p_token text, p_activity jsonb, p_status text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then return json_build_object('ok', false, 'error', 'Сессия устарела — войди заново'); end if;
  if p_activity is not null and length(p_activity::text) > 8000 then
    return json_build_object('ok', false, 'error', 'Слишком большая активность');
  end if;
  update public.accounts
     set activity = p_activity,
         status = case when p_status in ('online', 'away', 'busy', 'playing', 'offline') then p_status else status end
   where id = acc.id;
  return json_build_object('ok', true);
end $$;

-- ───────────────────────── direct_messages ─────────────────────────
alter table public.direct_messages enable row level security;
revoke all on public.direct_messages from anon, authenticated;
grant select on public.direct_messages to anon, authenticated;

-- Убираем все старые политики (обычно там «разрешить всё») и оставляем только чтение общего чата.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'direct_messages' loop
    execute format('drop policy %I on public.direct_messages', p.policyname);
  end loop;
end $$;
create policy grom_dm_read_general on public.direct_messages for select to anon, authenticated using (to_nickname = 'general');

-- История одного чата: 'general' или переписка с конкретным ником. Только для участника.
create or replace function public.dm_history(p_token text, p_with text) returns setof public.direct_messages
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then raise exception 'Сессия устарела — войди заново'; end if;
  if p_with = 'general' then
    return query select * from (
      select * from public.direct_messages where to_nickname = 'general' order by created_at desc limit 300
    ) t order by created_at;
  else
    return query select * from (
      select * from public.direct_messages
       where (from_nickname = acc.nickname and to_nickname = p_with)
          or (from_nickname = p_with and to_nickname = acc.nickname)
       order by created_at desc limit 500
    ) t order by created_at;
  end if;
end $$;

-- Последние сообщения во всех моих личных чатах — для списка чатов.
create or replace function public.dm_conversations(p_token text) returns setof public.direct_messages
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then raise exception 'Сессия устарела — войди заново'; end if;
  return query select * from public.direct_messages
   where (from_nickname = acc.nickname or to_nickname = acc.nickname) and to_nickname <> 'general'
   order by created_at desc limit 500;
end $$;

-- Отправить сообщение от своего имени.
create or replace function public.dm_send(
  p_token text, p_to text, p_text text default null, p_file_url text default null, p_file_name text default null,
  p_reply_to_id public.direct_messages.reply_to_id%type default null, p_reply_to_text text default null, p_reply_to_author text default null
) returns public.direct_messages
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token); m public.direct_messages;
begin
  if acc.id is null then raise exception 'Сессия устарела — войди заново'; end if;
  if coalesce(btrim(p_text), '') = '' and p_file_url is null then raise exception 'Пустое сообщение'; end if;
  if length(coalesce(p_text, '')) > 4000 then raise exception 'Сообщение длиннее 4000 символов'; end if;
  if p_file_url is not null and (p_file_url !~ '^https://' or length(p_file_url) > 500) then raise exception 'Некорректная ссылка на файл'; end if;
  if p_to <> 'general' and not exists (select 1 from public.accounts where nickname = p_to) then raise exception 'Нет такого пользователя'; end if;
  if (select count(*) from public.direct_messages where from_nickname = acc.nickname and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Слишком часто — подожди минуту';
  end if;
  insert into public.direct_messages (from_nickname, to_nickname, text, file_url, file_name, reply_to_id, reply_to_text, reply_to_author)
  values (acc.nickname, p_to, nullif(btrim(p_text), ''), p_file_url, left(p_file_name, 200), p_reply_to_id, left(p_reply_to_text, 300), p_reply_to_author)
  returning * into m;
  return m;
end $$;

-- Изменить своё сообщение.
create or replace function public.dm_edit(p_token text, p_id public.direct_messages.id%type, p_text text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then return json_build_object('ok', false, 'error', 'Сессия устарела — войди заново'); end if;
  if coalesce(btrim(p_text), '') = '' or length(p_text) > 4000 then return json_build_object('ok', false, 'error', 'Пустое или слишком длинное сообщение'); end if;
  update public.direct_messages set text = btrim(p_text), edited = true where id = p_id and from_nickname = acc.nickname;
  if not found then return json_build_object('ok', false, 'error', 'Можно менять только свои сообщения'); end if;
  return json_build_object('ok', true);
end $$;

-- Удалить своё сообщение.
create or replace function public.dm_delete(p_token text, p_id public.direct_messages.id%type) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then return json_build_object('ok', false, 'error', 'Сессия устарела — войди заново'); end if;
  delete from public.direct_messages where id = p_id and from_nickname = acc.nickname;
  if not found then return json_build_object('ok', false, 'error', 'Можно удалять только свои сообщения'); end if;
  return json_build_object('ok', true);
end $$;

revoke all on function
  public.account_touch(text), public.account_update(text, text, text, text), public.account_set_activity(text, jsonb, text),
  public.dm_history(text, text), public.dm_conversations(text)
  from public;
grant execute on function
  public.account_touch(text), public.account_update(text, text, text, text), public.account_set_activity(text, jsonb, text),
  public.dm_history(text, text), public.dm_conversations(text)
  to anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('dm_send', 'dm_edit', 'dm_delete') loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

-- Старые сессии без токена больше не работают — на всякий случай удаляем мусорные попытки.
delete from public.auth_attempts where at < now() - interval '1 day';

-- ───────────── Обязательное обновление (выполни ПОСЛЕ того, как релиз 1.5.3 появится на GitHub) ─────────────
-- update public.launcher_control
--    set version = '1.5.3', required = true,
--        features = '["Исправлена безопасность аккаунтов и сообщений — обновление обязательно"]'::jsonb,
--        updated_at = now()
--  where id = 1;

-- Старая неиспользуемая таблица profiles (если есть) — запрещаем запись в неё.
do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'revoke insert, update, delete on public.profiles from anon, authenticated';
  end if;
end $$;
