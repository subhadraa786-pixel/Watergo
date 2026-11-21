-- WaterGo marketplace tables. This migration does NOT alter existing orders/suppliers tables.
create extension if not exists pgcrypto;

create table if not exists public.watergo_supplier_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  business_name text not null,
  phone text not null,
  service_areas text[] not null default '{}',
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.watergo_delivery_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  full_name text not null,
  phone text not null,
  vehicle_type text not null default '',
  service_areas text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.watergo_order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  assignee_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('supplier','delivery')),
  status text not null default 'assigned'
    check (status in ('assigned','accepted','ready','picked_up','delivered','declined')),
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, role)
);

create table if not exists public.watergo_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.watergo_supplier_profiles enable row level security;
alter table public.watergo_delivery_profiles enable row level security;
alter table public.watergo_order_assignments enable row level security;
alter table public.watergo_order_events enable row level security;

-- No direct client write policies. The Netlify server uses the service-role key;
-- it must be stored only in Netlify environment variables, never in browser code.
grant select on public.watergo_supplier_profiles, public.watergo_delivery_profiles,
  public.watergo_order_assignments, public.watergo_order_events to authenticated;
