create table if not exists public.launcher_control (
  id integer primary key check (id = 1),
  required boolean not null default false,
  version text not null default '1.4.5',
  features jsonb not null default '[]'::jsonb,
  website_url text not null default 'https://gromclient.devs.li',
  updated_at timestamptz not null default now()
);
insert into public.launcher_control (id, required, version, features, website_url)
values (1, false, '1.4.5', '["Первый запуск удалённого управления обновлениями"]'::jsonb, 'https://gromclient.devs.li')
on conflict (id) do nothing;
alter table public.launcher_control enable row level security;
revoke all on public.launcher_control from anon, authenticated;
