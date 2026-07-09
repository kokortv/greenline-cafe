-- =========================================================================
-- МИГРАЦИЯ — добавить новые колонки для модификаций
-- Запустите это в Supabase SQL Editor → Run (обычный, БЕЗ "Run and enable RLS")
-- Это безопасно для повторного запуска (везде IF NOT EXISTS).
-- =========================================================================

-- 1. Добавить колонки в таблицу menu (если их ещё нет)
alter table public.menu add column if not exists cost numeric default 0;
alter table public.menu add column if not exists markup numeric default 0;
alter table public.menu add column if not exists has_modifications boolean default false;

-- 2. Добавить колонки в таблицу order_items (если их ещё нет)
alter table public.order_items add column if not exists modification_id text default '';
alter table public.order_items add column if not exists modification_name text default '';

-- 3. Создать таблицу menu_modifications (если её ещё нет)
create table if not exists public.menu_modifications (
  id text primary key,
  menu_id text not null,
  name text not null,
  name_translation text default '',
  price numeric default 0,
  cost numeric default 0,
  markup numeric default 0,
  sort int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 4. Индекс для menu_modifications
create index if not exists idx_menu_modifications_menu_id on public.menu_modifications(menu_id);

-- 5. Отключить RLS на новой таблице
alter table public.menu_modifications disable row level security;

-- 6. Выдать права роли anon на новую таблицу
grant all on public.menu_modifications to anon, authenticated;

-- 7. Добавить menu_modifications в Realtime publication (если ещё не добавлена)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'menu_modifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_modifications;
  END IF;
END $$;

-- =========================================================================
-- ПРОВЕРКА — запустите этот запрос отдельно, чтобы убедиться, что всё на месте:
--
--   select column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'menu'
--   order by ordinal_position;
--
-- Должны быть колонки: id, category_id, name, name_translation, price,
-- needs_cooking, sort, is_active, stock, cost, markup, has_modifications
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'order_items'
--   order by ordinal_position;
--
-- Должны быть: modification_id, modification_name среди прочих
--
--   select count(*) from public.menu_modifications;
-- Должен вернуть 0 (пока нет модификаций)
-- =========================================================================
