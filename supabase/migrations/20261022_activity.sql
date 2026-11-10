-- "Играть с другом": публичная активность игрока (адрес туннеля + код сборки).
alter table public.accounts add column if not exists activity jsonb;
-- быстрые выборки «меня пригласили» / «открыто для всех»
create index if not exists accounts_activity_gin on public.accounts using gin (activity jsonb_path_ops);
