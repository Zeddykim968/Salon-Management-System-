-- ============================================================================
-- Salon Platform — full schema
-- Run this in the Supabase SQL Editor (or `supabase db reset` locally).
-- Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('customer','salonist','nail_tech','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum ('pending','confirmed','declined','cancelled','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_status as enum ('available','busy','off');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id               uuid primary key references auth.users on delete cascade,
  full_name        text not null default '',
  phone            text,
  role             user_role not null default 'customer',
  avatar_url       text,
  marketing_opt_in boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists staff_details (
  staff_id    uuid primary key references profiles(id) on delete cascade,
  bio         text,
  whatsapp    text,                       -- E.164 without '+', e.g. 2547XXXXXXXX
  status      staff_status not null default 'available',
  status_note text,
  updated_at  timestamptz not null default now()
);

create table if not exists services (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null check (category in ('hair','nails')),
  price_kes    int  not null check (price_kes >= 0),
  duration_min int  not null check (duration_min between 5 and 600),
  image_url    text,
  active       boolean not null default true
);

create table if not exists staff_services (
  staff_id   uuid references profiles(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  primary key (staff_id, service_id)
);

create table if not exists working_hours (
  id         bigserial primary key,
  staff_id   uuid references profiles(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time time not null,
  end_time   time not null,
  check (start_time < end_time)
);

create table if not exists bookings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  staff_id    uuid not null references profiles(id),
  service_id  uuid not null references services(id),
  during      tstzrange not null,
  status      booking_status not null default 'pending',
  notes       text,
  created_at  timestamptz not null default now(),
  -- the database itself prevents double booking of a slot
  exclude using gist (staff_id with =, during with &&)
    where (status in ('pending','confirmed'))
);

create table if not exists gallery (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references profiles(id) on delete set null,
  image_url  text not null,
  caption    text,
  approved   boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists site_assets (               -- hero image, banners, etc.
  key       text primary key,            -- 'hero', 'banner_1', ...
  image_url text not null,
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references profiles(id),
  recipient_id uuid not null references profiles(id),
  body         text not null check (length(body) > 0),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create table if not exists campaigns (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id),
  channel    text not null check (channel in ('email','whatsapp')),
  subject    text,
  body       text not null,
  audience   text not null default 'all_customers',
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists activity_log (              -- what the Admin monitors
  id         bigserial primary key,
  actor_id   uuid references profiles(id),
  action     text not null,              -- 'booking.confirm', 'gallery.upload', 'status.busy'
  meta       jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_bookings_staff_during  on bookings using gist (staff_id, during);
create index if not exists idx_bookings_customer      on bookings (customer_id, created_at desc);
create index if not exists idx_bookings_staff_created on bookings (staff_id, created_at desc);
create index if not exists idx_working_hours_staff    on working_hours (staff_id, weekday);
create index if not exists idx_messages_pair          on messages (sender_id, recipient_id, created_at);
create index if not exists idx_messages_recipient     on messages (recipient_id, created_at desc);
create index if not exists idx_gallery_staff          on gallery (staff_id, created_at desc);
create index if not exists idx_activity_created       on activity_log (created_at desc);
create index if not exists idx_profiles_role          on profiles (role);

-- ---------------------------------------------------------------------------
-- Auto-create a customer profile on signup (role is never taken from the client)
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    nullif(new.raw_user_meta_data->>'phone','')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Nobody can escalate their own role from the browser (backend service role
-- bypasses RLS and is trusted to assign roles)
-- ---------------------------------------------------------------------------
create or replace function protect_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  my_role user_role;
begin
  select role into my_role from profiles where id = auth.uid();
  if new.role is distinct from old.role and coalesce(my_role, 'customer') <> 'admin' then
    raise exception 'role changes are admin-only';
  end if;
  return new;
end; $$;

drop trigger if exists protect_profile_role on profiles;
create trigger protect_profile_role
  before update of role on profiles
  for each row execute function protect_profile_role();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table profiles      enable row level security;
alter table staff_details enable row level security;
alter table services      enable row level security;
alter table staff_services enable row level security;
alter table working_hours enable row level security;
alter table bookings      enable row level security;
alter table gallery       enable row level security;
alter table site_assets   enable row level security;
alter table messages      enable row level security;
alter table campaigns     enable row level security;
alter table activity_log  enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists "profiles read own or staff" on profiles;
create policy "profiles read own or staff" on profiles
  for select using (
    id = auth.uid()
    or role in ('salonist','nail_tech')
    or coalesce((select p.role from profiles p where p.id = auth.uid()), 'customer') in ('admin')
  );

drop policy if exists "profiles update own" on profiles;
create policy "profiles update own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- staff_details (status + whatsapp are public signals on the site) -----------
drop policy if exists "staff_details public read" on staff_details;
create policy "staff_details public read" on staff_details
  for select using (true);

drop policy if exists "staff_details own write" on staff_details;
create policy "staff_details own write" on staff_details
  for insert with check (staff_id = auth.uid());

drop policy if exists "staff_details own update" on staff_details;
create policy "staff_details own update" on staff_details
  for update using (staff_id = auth.uid()) with check (staff_id = auth.uid());

-- services / staff_services / working_hours ---------------------------------
drop policy if exists "services public read" on services;
create policy "services public read" on services for select using (true);

drop policy if exists "staff_services public read" on staff_services;
create policy "staff_services public read" on staff_services for select using (true);

drop policy if exists "working_hours public read" on working_hours;
create policy "working_hours public read" on working_hours for select using (true);

-- bookings -------------------------------------------------------------------
drop policy if exists "customer sees own bookings" on bookings;
create policy "customer sees own bookings" on bookings
  for select using (customer_id = auth.uid());

drop policy if exists "staff sees own schedule" on bookings;
create policy "staff sees own schedule" on bookings
  for select using (staff_id = auth.uid());

drop policy if exists "customer requests own bookings" on bookings;
create policy "customer requests own bookings" on bookings
  for insert with check (customer_id = auth.uid() and status = 'pending');

drop policy if exists "booking sides may update" on bookings;
create policy "booking sides may update" on bookings
  for update using (customer_id = auth.uid() or staff_id = auth.uid())
  with check (customer_id = auth.uid() or staff_id = auth.uid());

-- gallery --------------------------------------------------------------------
drop policy if exists "gallery approved public read" on gallery;
create policy "gallery approved public read" on gallery
  for select using (approved or staff_id = auth.uid()
    or coalesce((select p.role from profiles p where p.id = auth.uid()), 'customer') = 'admin');

drop policy if exists "staff inserts own gallery" on gallery;
create policy "staff inserts own gallery" on gallery
  for insert with check (
    staff_id = auth.uid()
    and coalesce((select p.role from profiles p where p.id = auth.uid()), 'customer')
        in ('salonist','nail_tech','admin')
  );

-- site_assets ----------------------------------------------------------------
drop policy if exists "site_assets public read" on site_assets;
create policy "site_assets public read" on site_assets for select using (true);

-- messages -------------------------------------------------------------------
drop policy if exists "messages read own" on messages;
create policy "messages read own" on messages
  for select using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "messages send as self" on messages;
create policy "messages send as self" on messages
  for insert with check (sender_id = auth.uid() and sender_id <> recipient_id);

drop policy if exists "messages recipient marks read" on messages;
create policy "messages recipient marks read" on messages
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- campaigns (admin only; backend uses the service role anyway) ---------------
drop policy if exists "campaigns admin read" on campaigns;
create policy "campaigns admin read" on campaigns
  for select using (
    coalesce((select p.role from profiles p where p.id = auth.uid()), 'customer') = 'admin'
  );

-- activity_log ---------------------------------------------------------------
drop policy if exists "activity admin read" on activity_log;
create policy "activity admin read" on activity_log
  for select using (
    coalesce((select p.role from profiles p where p.id = auth.uid()), 'customer') = 'admin'
  );

drop policy if exists "activity insert own" on activity_log;
create policy "activity insert own" on activity_log
  for insert with check (actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime (live chat + live schedule for staff)
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table bookings;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Storage buckets: public read, writes only through the backend
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true), ('site', 'site', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed services so the site works immediately
-- ---------------------------------------------------------------------------
insert into services (id, name, category, price_kes, duration_min) values
  ('11111111-1111-4111-8111-111111111101', 'Box Braids',        'hair',  2500, 240),
  ('11111111-1111-4111-8111-111111111102', 'Knotless Braids',   'hair',  3000, 300),
  ('11111111-1111-4111-8111-111111111103', 'Wig Install',       'hair',  1500, 120),
  ('11111111-1111-4111-8111-111111111104', 'Retwist',           'hair',  1000,  90),
  ('11111111-1111-4111-8111-111111111105', 'Silk Press',        'hair',  2000, 120),
  ('11111111-1111-4111-8111-111111111106', 'Trim & Style',      'hair',   800,  45),
  ('22222222-2222-4222-8222-222222222201', 'Gel Manicure',      'nails', 1200,  60),
  ('22222222-2222-4222-8222-222222222202', 'Acrylic Full Set',  'nails', 2000, 120),
  ('22222222-2222-4222-8222-222222222203', 'Nail Art',          'nails',  500,  45),
  ('22222222-2222-4222-8222-222222222204', 'Pedicure',          'nails', 1000,  60),
  ('22222222-2222-4222-8222-222222222205', 'Gel Refill',        'nails', 1500,  90)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Default working hours are seeded by the backend when a staff member is
-- invited (Mon–Sat 09:00–18:00), and can be edited in the database.
-- ---------------------------------------------------------------------------
