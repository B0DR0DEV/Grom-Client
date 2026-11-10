-- Серверный вход/регистрация (общие для сайта и лаунчера), токены сессий и облачные скины.
-- Хеш пароля больше не нужен клиенту. Совместимо с существующими bcrypt-хешами ($2a$) из старого лаунчера.
create extension if not exists pgcrypto with schema extensions;

-- ── ограничение частоты попыток ──
create table if not exists public.auth_attempts (k text not null, at timestamptz not null default now());
create index if not exists auth_attempts_k_at on public.auth_attempts (k, at);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;

-- ── сессии: в базе хранится только sha256 токена ──
create table if not exists public.account_sessions (
  token_hash text primary key,
  account_id text not null,
  created_at timestamptz not null default now(),
  last_used  timestamptz not null default now()
);
create index if not exists account_sessions_account on public.account_sessions (account_id);
alter table public.account_sessions enable row level security;
revoke all on public.account_sessions from anon, authenticated;

-- ── скины: PNG в базе, наружу отдаёт edge-функция skin ──
create table if not exists public.skins (
  account_id text primary key,
  nickname   text not null,
  png        bytea not null,
  updated_at timestamptz not null default now()
);
create index if not exists skins_nick_lower on public.skins (lower(nickname));
alter table public.skins enable row level security;
revoke all on public.skins from anon, authenticated;

create or replace function public._client_ip() returns text language sql stable as $$
  select coalesce(nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), ''), 'unknown')
$$;

create or replace function public._account_json(a public.accounts) returns json language sql stable as $$
  select json_build_object('id', a.id, 'nickname', a.nickname, 'avatar_url', a.avatar_url, 'status', a.status, 'created_at', a.created_at)
$$;

create or replace function public._new_session(p_account_id text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into public.account_sessions (token_hash, account_id) values (encode(digest(t, 'sha256'), 'hex'), p_account_id);
  -- не больше 10 активных сессий на аккаунт
  delete from public.account_sessions where account_id = p_account_id and token_hash not in (
    select token_hash from public.account_sessions where account_id = p_account_id order by last_used desc limit 10);
  return t;
end $$;

create or replace function public._session_account(p_token text) returns public.accounts
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts; h text := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
begin
  update public.account_sessions set last_used = now() where token_hash = h and last_used > now() - interval '90 days';
  if not found then return null; end if;
  select a.* into acc from public.accounts a join public.account_sessions s on s.account_id = a.id::text where s.token_hash = h;
  return acc;
end $$;

create or replace function public.register_account(p_nickname text, p_password text, p_avatar_url text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare n text := btrim(coalesce(p_nickname, '')); ip text := public._client_ip(); acc public.accounts;
begin
  if n !~ '^[A-Za-z0-9_]{3,16}$' then return json_build_object('ok', false, 'error', 'Ник: 3–16 символов, латиница, цифры и _'); end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then return json_build_object('ok', false, 'error', 'Пароль: от 6 до 72 символов'); end if;
  if (select count(*) from public.auth_attempts where k = 'reg:' || ip and at > now() - interval '1 hour') >= 5 then
    return json_build_object('ok', false, 'error', 'Слишком много регистраций с вашего адреса, попробуйте позже');
  end if;
  if exists (select 1 from public.accounts where lower(nickname) = lower(n)) then return json_build_object('ok', false, 'error', 'Этот ник уже занят'); end if;
  insert into public.auth_attempts (k) values ('reg:' || ip);
  begin
    insert into public.accounts (nickname, password_hash, avatar_url, status)
    values (n, crypt(p_password, gen_salt('bf', 12)), p_avatar_url, 'online') returning * into acc;
  exception when unique_violation then
    return json_build_object('ok', false, 'error', 'Этот ник уже занят');
  end;
  return json_build_object('ok', true, 'account', public._account_json(acc), 'token', public._new_session(acc.id::text));
end $$;

create or replace function public.login_account(p_nickname text, p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare n text := btrim(coalesce(p_nickname, '')); ip text := public._client_ip(); acc public.accounts;
begin
  if (select count(*) from public.auth_attempts where k = 'login:' || lower(n) and at > now() - interval '15 minutes') >= 8
     or (select count(*) from public.auth_attempts where k = 'loginip:' || ip and at > now() - interval '15 minutes') >= 40 then
    return json_build_object('ok', false, 'error', 'Слишком много попыток входа. Подождите 15 минут');
  end if;
  select * into acc from public.accounts where lower(nickname) = lower(n) order by (nickname = n) desc limit 1;
  if not found or acc.password_hash is null or crypt(coalesce(p_password, ''), acc.password_hash) <> acc.password_hash then
    insert into public.auth_attempts (k) values ('login:' || lower(n)), ('loginip:' || ip);
    return json_build_object('ok', false, 'error', 'Неверный ник или пароль');
  end if;
  delete from public.auth_attempts where k = 'login:' || lower(n);
  return json_build_object('ok', true, 'account', public._account_json(acc), 'token', public._new_session(acc.id::text));
end $$;

create or replace function public.logout_session(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.account_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.session_account(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token);
begin
  if acc.id is null then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'account', public._account_json(acc));
end $$;

-- PNG 64×64 или 64×32, до 64 КБ. Сохраняется под текущим ником аккаунта.
create or replace function public.publish_skin(p_token text, p_png_b64 text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare acc public.accounts := public._session_account(p_token); b bytea; w int; h int;
begin
  if acc.id is null then return json_build_object('ok', false, 'error', 'Сессия устарела — выйди и войди в аккаунт заново'); end if;
  begin b := decode(p_png_b64, 'base64'); exception when others then return json_build_object('ok', false, 'error', 'Повреждённый файл'); end;
  if length(b) > 65536 or length(b) < 33 or substring(b from 1 for 8) <> '\x89504e470d0a1a0a'::bytea then
    return json_build_object('ok', false, 'error', 'Скин должен быть PNG до 64 КБ');
  end if;
  w := (get_byte(b, 16) << 24) | (get_byte(b, 17) << 16) | (get_byte(b, 18) << 8) | get_byte(b, 19);
  h := (get_byte(b, 20) << 24) | (get_byte(b, 21) << 16) | (get_byte(b, 22) << 8) | get_byte(b, 23);
  if w <> 64 or h not in (32, 64) then return json_build_object('ok', false, 'error', 'Скин должен быть 64×64 или 64×32'); end if;
  insert into public.skins (account_id, nickname, png, updated_at) values (acc.id::text, acc.nickname, b, now())
  on conflict (account_id) do update set nickname = excluded.nickname, png = excluded.png, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- Читает только edge-функция (service_role). Ник без учёта регистра.
create or replace function public.get_skin(p_nickname text) returns text
language sql stable security definer set search_path = public as $$
  select encode(png, 'base64') from public.skins where lower(nickname) = lower(p_nickname) order by updated_at desc limit 1
$$;

revoke all on function public.get_skin(text), public._new_session(text), public._session_account(text) from public, anon, authenticated;
grant execute on function public.get_skin(text) to service_role;
grant execute on function public.register_account(text, text, text), public.login_account(text, text),
  public.logout_session(text), public.session_account(text), public.publish_skin(text, text) to anon, authenticated;

-- Чистка старых попыток (можно по расписанию): delete from public.auth_attempts where at < now() - interval '1 day';
