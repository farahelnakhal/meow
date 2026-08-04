--families table (one row per account)
create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  max_budget numeric(10, 2) not null default 0,
  geofence_radius_meters integer not null default 500,
  games_owned text[] default '{}',
  created_at timestamptz not null default now()
);

--fmily members (parents, kids etc)
create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role text not null check (role in ('parent', 'caregiver', 'child')),
  birth_year integer,
  created_at timestamptz not null default now()
);

--index
create index idx_family_members_family_id on family_members(family_id);

alter table families enable row level security;
alter table family_members enable row level security;
