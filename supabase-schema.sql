-- =========================================================================
-- Restaurant App — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New query → paste → Run
-- =========================================================================

-- 1. SETTINGS (key-value table)
create table if not exists public.settings (
  key text primary key,
  value text
);

-- 2. CATEGORIES
create table if not exists public.categories (
  id text primary key,
  parent_id text default '',
  name text not null,
  name_translation text default '',
  sort int default 0,
  is_active boolean default true
);

-- 3. MENU
create table if not exists public.menu (
  id text primary key,
  category_id text default '',
  name text not null,
  name_translation text default '',
  price numeric default 0,
  needs_cooking boolean default true,
  sort int default 0,
  is_active boolean default true,
  stock int default 0
);

-- 4. USERS (staff)
create table if not exists public.users (
  id text primary key,
  name text not null,
  role text not null default 'waiter', -- waiter | cook | admin
  pin text default '',
  is_active boolean default true,
  sort int default 0,
  created_at timestamptz default now()
);

-- 5. ORDERS
create table if not exists public.orders (
  id text primary key,
  table_number text,
  table_type text default 'numbered', -- numbered | virtual | tab
  tab_id text default '',
  guests int default 1,
  main_category_id text default '',
  main_category_name text default '',
  status text default 'accepted', -- accepted | paused | completed
  total numeric default 0,
  created_at timestamptz default now(),
  completed_at timestamptz,
  waiter_note text default '',
  waiter_id text default '',
  waiter_name text default '',
  cook_id text default '',
  cook_name text default '',
  payment_method text default '' -- cash | card
);

-- 6. ORDER_ITEMS
create table if not exists public.order_items (
  id text primary key,
  order_id text not null,
  menu_item_id text default '',
  name text not null,
  name_translation text default '',
  category_name text default '',
  category_name_translation text default '',
  price numeric default 0,
  quantity int default 1,
  comment text default '',
  is_ready boolean default false,
  is_served boolean default false,
  needs_cooking boolean default true,
  created_at timestamptz default now()
);

-- 7. TABS (open client accounts)
create table if not exists public.tabs (
  id text primary key,
  name text not null,
  phone text default '',
  notes text default '',
  total numeric default 0,
  status text default 'open', -- open | closed
  created_at timestamptz default now(),
  closed_at timestamptz,
  created_by_waiter_id text default '',
  created_by_waiter_name text default ''
);

-- 8. SHIFTS (waiter work sessions)
create table if not exists public.shifts (
  id text primary key,
  waiter_id text not null,
  waiter_name text default '',
  opened_at timestamptz default now(),
  closed_at timestamptz,
  opening_cash numeric default 0,
  orders_count int default 0,
  guests_count int default 0,
  cash_total numeric default 0,
  card_total numeric default 0,
  status text default 'open' -- open | closed
);

-- =========================================================================
-- DEFAULT DATA
-- =========================================================================

-- Settings
insert into public.settings (key, value) values
  ('currency', '₽'),
  ('table_count', '20'),
  ('restaurant_name', 'Мой Ресторан'),
  ('sound_notifications', 'true'),
  ('translation_lang', ''),
  ('poll_interval_waiter', '20'),
  ('poll_interval_cook', '10'),
  ('virtual_tables', 'Бар'),
  ('cook_enabled', 'true'),
  ('cash_register', '0'),
  ('stock_tracking', 'false'),
  ('stock_threshold', '5')
on conflict (key) do nothing;

-- Categories
insert into public.categories (id, parent_id, name, name_translation, sort, is_active) values
  ('c1', '', 'Завтрак', '', 1, true),
  ('c2', '', 'Обед', '', 2, true),
  ('c3', '', 'Ужин', '', 3, true),
  ('c4', '', 'Бар', '', 4, true),
  ('s1', 'c1', 'Яичницы и омлеты', '', 1, true),
  ('s2', 'c1', 'Каши', '', 2, true),
  ('s3', 'c1', 'Сладкое', '', 3, true),
  ('s4', 'c2', 'Первые блюда', '', 1, true),
  ('s5', 'c2', 'Горячее', '', 2, true),
  ('s6', 'c2', 'Закуски', '', 3, true),
  ('s7', 'c2', 'Салаты', '', 4, true),
  ('s8', 'c3', 'Горячее', '', 1, true),
  ('s9', 'c3', 'Закуски', '', 2, true),
  ('s10', 'c3', 'Салаты', '', 3, true),
  ('s11', 'c3', 'Десерты', '', 4, true),
  ('s12', 'c4', 'Алкоголь', '', 1, true),
  ('s13', 'c4', 'Безалкогольные', '', 2, true),
  ('s14', 'c4', 'Снеки', '', 3, true)
on conflict (id) do nothing;

-- Sample menu items
insert into public.menu (id, category_id, name, name_translation, price, needs_cooking, sort, is_active, stock) values
  ('m1', 's1', 'Яичница с ветчиной', 'Eggs with ham', 280, true, 1, true, 0),
  ('m2', 's1', 'Омлет с сыром', 'Cheese omelette', 250, true, 2, true, 0),
  ('m3', 's2', 'Овсяная каша', 'Oatmeal', 180, true, 1, true, 0),
  ('m4', 's2', 'Гречневая каша', 'Buckwheat porridge', 180, true, 2, true, 0),
  ('m5', 's3', 'Сырники', 'Cottage cheese pancakes', 320, true, 1, true, 0),
  ('m6', 's3', 'Блинчики с медом', 'Pancakes with honey', 220, true, 2, true, 0),
  ('m7', 's4', 'Борщ', 'Borscht', 290, true, 1, true, 0),
  ('m8', 's4', 'Куриный суп', 'Chicken soup', 270, true, 2, true, 0),
  ('m9', 's5', 'Стейк рибай', 'Ribeye steak', 1200, true, 1, true, 0),
  ('m10', 's5', 'Куриная грудка гриль', 'Grilled chicken breast', 540, true, 2, true, 0),
  ('m11', 's6', 'Брускетта', 'Bruschetta', 320, true, 1, true, 0),
  ('m12', 's7', 'Цезарь с курицей', 'Caesar with chicken', 420, true, 1, true, 0),
  ('m13', 's7', 'Греческий салат', 'Greek salad', 380, true, 2, true, 0),
  ('m14', 's8', 'Лосось на гриле', 'Grilled salmon', 980, true, 1, true, 0),
  ('m15', 's9', 'Карпаччо', 'Carpaccio', 560, true, 1, true, 0),
  ('m16', 's11', 'Тирамису', 'Tiramisu', 340, true, 1, true, 0),
  ('m17', 's12', 'Вино красное (бокал)', 'Red wine (glass)', 380, false, 1, true, 0),
  ('m18', 's12', 'Пиво разливное 0.5', 'Draft beer 0.5', 280, false, 2, true, 0),
  ('m19', 's13', 'Кола 0.5', 'Cola 0.5', 180, false, 1, true, 0),
  ('m20', 's13', 'Вода минеральная 0.5', 'Mineral water 0.5', 120, false, 2, true, 0),
  ('m21', 's14', 'Орешки', 'Nuts', 150, false, 1, true, 0),
  ('m22', 's14', 'Чипсы', 'Chips', 160, false, 2, true, 0),
  ('m23', 's5', 'Хлеб (багет)', 'Bread (baguette)', 60, false, 3, true, 0)
on conflict (id) do nothing;

-- Default users (passwords are empty by default — set via admin UI)
insert into public.users (id, name, role, pin, is_active, sort) values
  ('u_w1', 'Анна', 'waiter', '', true, 1),
  ('u_w2', 'Борис', 'waiter', '', true, 2),
  ('u_w3', 'Виктор', 'waiter', '', true, 3),
  ('u_c1', 'Повар 1', 'cook', '', true, 1),
  ('u_c2', 'Повар 2', 'cook', '', true, 2),
  ('u_admin', 'Администратор', 'admin', '', true, 0)
on conflict (id) do nothing;

-- =========================================================================
-- INDEXES (for performance)
-- =========================================================================
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_waiter_id on public.orders(waiter_id);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_menu_category_id on public.menu(category_id);
create index if not exists idx_categories_parent_id on public.categories(parent_id);
create index if not exists idx_shifts_waiter_id_status on public.shifts(waiter_id, status);
create index if not exists idx_tabs_status on public.tabs(status);

-- =========================================================================
-- ROW LEVEL SECURITY (RLS)
-- We disable RLS for now — the app handles access control in the frontend.
-- If you need server-side security, enable RLS and add policies.
-- =========================================================================
alter table public.settings disable row level security;
alter table public.categories disable row level security;
alter table public.menu disable row level security;
alter table public.users disable row level security;
alter table public.orders disable row level security;
alter table public.order_items disable row level security;
alter table public.tabs disable row level security;
alter table public.shifts disable row level security;

-- =========================================================================
-- REALTIME — enable for tables that need instant updates
-- =========================================================================
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.shifts;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.menu;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.users;

-- =========================================================================
-- RPC FUNCTIONS — atomic stock operations (bypass RLS for table writes)
-- These run with SECURITY DEFINER so they work even if RLS is enabled on menu.
-- =========================================================================

-- Replenish stock: atomically add delta to menu.stock, return the new value.
-- delta may be negative (for deducting stock when an order is placed).
-- Stock is clamped at 0 (never goes negative).
create or replace function public.replenish_stock(p_menu_id text, p_delta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  update public.menu
     set stock = greatest(0, coalesce(stock, 0) + p_delta)
   where id = p_menu_id
   returning stock into v_new;

  if v_new is null then
    raise exception 'Menu item not found: %', p_menu_id;
  end if;

  return v_new;
end;
$$;

-- Grant execute to anon and authenticated roles
grant execute on function public.replenish_stock(text, int) to anon, authenticated;

-- =========================================================================
-- DONE!
-- After running this:
-- 1. Go to Settings → API to get your Project URL and anon key
-- 2. Put them in config.js:
--    SUPABASE_URL: 'https://xxxxx.supabase.co'
--    SUPABASE_ANON_KEY: 'eyJhbGciOi...'
-- 3. Download supabase-js from: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
--    Save as supabase.js and include it before common.js
-- =========================================================================
