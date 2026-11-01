create type public.app_role as enum ('admin', 'driver');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  vehicle text,
  phone text,
  speed_limit_kmh integer not null default 80,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  distance_km numeric not null default 0,
  max_speed_kmh numeric not null default 0,
  avg_speed_kmh numeric not null default 0,
  drowsy_events integer not null default 0,
  critical_events integer not null default 0,
  speeding_events integer not null default 0,
  current_lat double precision,
  current_lng double precision,
  current_speed_kmh numeric,
  current_state text not null default 'alert',
  last_ping_at timestamptz,
  notes text
);

create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  lat double precision,
  lng double precision,
  speed_kmh numeric,
  value numeric,
  detail text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_trips_driver on public.trips(driver_id);
create index idx_trips_active on public.trips(last_ping_at) where ended_at is null;
create index idx_events_trip on public.trip_events(trip_id);
create index idx_events_driver_time on public.trip_events(driver_id, occurred_at desc);

grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
grant select, insert, update on public.trips to authenticated;
grant all on public.trips to service_role;
grant select, insert on public.trip_events to authenticated;
grant all on public.trip_events to service_role;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_events enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create policy "profiles: read own"
on public.profiles for select to authenticated
using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "profiles: insert own"
on public.profiles for insert to authenticated
with check (id = auth.uid());

create policy "profiles: update own"
on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "roles: read own or admin"
on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "trips: read own or admin"
on public.trips for select to authenticated
using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "trips: insert own"
on public.trips for insert to authenticated
with check (driver_id = auth.uid());

create policy "trips: update own or admin"
on public.trips for update to authenticated
using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
with check (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "events: read own or admin"
on public.trip_events for select to authenticated
using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "events: insert own"
on public.trip_events for insert to authenticated
with check (driver_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case when lower(new.email) = 'adnanfareed516@gmail.com' then 'admin'::app_role else 'driver'::app_role end
  )
  on conflict (user_id, role) do nothing;

  return new;
end
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill any users that already exist
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select u.id,
  case when lower(u.email) = 'adnanfareed516@gmail.com' then 'admin'::app_role else 'driver'::app_role end
from auth.users u
on conflict (user_id, role) do nothing;