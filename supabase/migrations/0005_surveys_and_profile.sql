--interest categories (reference data, seeded)
create table interest_categories (
  key text primary key,
  label text not null,
  sort_order integer not null
);

insert into interest_categories (key, label, sort_order) values
  ('arts', 'Arts & Crafts', 1),
  ('cooking', 'Cooking & Baking', 2),
  ('outdoors', 'Outdoors & Exploring', 3),
  ('games', 'Games & Puzzles', 4),
  ('sports', 'Sports & Movement', 5),
  ('music', 'Music & Performance', 6),
  ('building', 'Building & Making', 7),
  ('animals', 'Animals & Pets', 8),
  ('books', 'Reading & Books', 9),
  ('science', 'Science & Discovery', 10),
  ('talking','Talking & Hanging Out', 11),
  ('nature','Nature & Environment', 12),
  ('technology','Technology & Innnovation', 13),
  ('fashion','Fashion & Style', 14),
  ('community','Community & Culture', 15);

alter table interest_categories enable row level security;

create policy "signed in users can read categories"
  on interest_categories for select
  using (auth.uid() is not null);

--member interest weights (0 = no, 3 = love)
create table member_interests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references family_members(id) on delete cascade,
  category_key text not null references interest_categories(key),
  weight smallint not null check (weight between 0 and 3),
  created_at timestamptz not null default now(),
  unique (member_id, category_key)
);

create index idx_member_interests_member on member_interests(member_id);
alter table member_interests enable row level security;

create policy "family can read own member interests"
  on member_interests for select
  using (member_id in (select id from family_members where family_id = get_my_family_id()));

create policy "family can write own member interests"
  on member_interests for insert
  with check (member_id in (select id from family_members where family_id = get_my_family_id()));

create policy "family can update own member interests"
  on member_interests for update
  using (member_id in (select id from family_members where family_id = get_my_family_id()));

--parent survey responses
create table parent_survey_responses (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references family_members(id) on delete cascade,
  question_key text not null,
  answer_value smallint,
  answer_text  text,
  created_at   timestamptz not null default now(),
  unique (member_id, question_key)
);

create index idx_survey_responses_member on parent_survey_responses(member_id);
alter table parent_survey_responses enable row level security;

create policy "family can read own survey responses"
  on parent_survey_responses for select
  using (member_id in (select id from family_members where family_id = get_my_family_id()));

create policy "family can write own survey responses"
  on parent_survey_responses for insert
  with check (member_id in (select id from family_members where family_id = get_my_family_id()));

create policy "family can update own survey responses"
  on parent_survey_responses for update
  using (member_id in (select id from family_members where family_id = get_my_family_id()));

--generated family profile — CLIENT READABLE half
create table family_profiles (
  family_id        uuid primary key references families(id) on delete cascade,
  summary          text not null,
  interest_weights jsonb not null default '{}'::jsonb,
  dynamics         jsonb not null default '{}'::jsonb,
  model            text,
  generated_at     timestamptz not null default now()
);

alter table family_profiles enable row level security;

create policy "family can read own profile"
  on family_profiles for select
  using (family_id = get_my_family_id());
-- no insert/update policy: only the edge function (service_role) writes here

--family profile — PRIVATE half
create table family_profile_private (
  family_id    uuid primary key references families(id) on delete cascade,
  skill_focus  text[] not null default '{}',
  rationale    text,
  generated_at timestamptz not null default now()
);

alter table family_profile_private enable row level security;
revoke all on family_profile_private from anon, authenticated;

-- Extend family creation RPC to capture limits at signup
drop function if exists create_family_with_parent(text, text);

create or replace function create_family_with_parent(
  p_family_name             text,
  p_parent_name             text,
  p_max_budget              numeric  default 0,
  p_geofence_radius_meters  integer  default 500,
  p_games_owned             text[]   default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from family_members where auth_user_id = auth.uid()) then
    raise exception 'user already belongs to a family';
  end if;

  insert into families (name, max_budget, geofence_radius_meters, games_owned)
  values (p_family_name, p_max_budget, p_geofence_radius_meters, p_games_owned)
  returning id into v_family_id;

  insert into family_members (family_id, auth_user_id, display_name, role)
  values (v_family_id, auth.uid(), p_parent_name, 'parent');

  return v_family_id;
end;
$$;

revoke all on function create_family_with_parent(text, text, numeric, integer, text[]) from public, anon;
grant execute on function create_family_with_parent(text, text, numeric, integer, text[]) to authenticated;