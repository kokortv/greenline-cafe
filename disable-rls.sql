-- =========================================================================
-- ОТКЛЮЧИТЬ RLS НА ВСЕХ ТАБЛИЦАХ ПРИЛОЖЕНИЯ
--
-- Запустите это в Supabase SQL Editor → Run (НЕ "Run and enable RLS")
-- Это исправит проблему "Склад пополнен, но остаток остался 0".
-- =========================================================================

alter table public.settings disable row level security;
alter table public.categories disable row level security;
alter table public.menu disable row level security;
alter table public.menu_modifications disable row level security;
alter table public.users disable row level security;
alter table public.orders disable row level security;
alter table public.order_items disable row level security;
alter table public.tabs disable row level security;
alter table public.shifts disable row level security;

-- Дополнительно: выдать роль anon полные права на чтение/запись всех таблиц.
-- Без этих грантов RLS не нужен, но Postgres может всё равно требовать прав.
grant all on public.settings to anon, authenticated;
grant all on public.categories to anon, authenticated;
grant all on public.menu to anon, authenticated;
grant all on public.menu_modifications to anon, authenticated;
grant all on public.users to anon, authenticated;
grant all on public.orders to anon, authenticated;
grant all on public.order_items to anon, authenticated;
grant all on public.tabs to anon, authenticated;
grant all on public.shifts to anon, authenticated;

-- Разрешить использование sequence (для timestamptz default now() и т.п.)
grant usage, select on all sequences in schema public to anon, authenticated;

-- =========================================================================
-- ПРОВЕРКА: после Run, выполните этот запрос в новой вкладке SQL Editor,
-- чтобы убедиться что RLS отключён:
--
--   select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--   order by tablename;
--
-- Все строки в столбце rowsecurity должны быть false.
-- =========================================================================
