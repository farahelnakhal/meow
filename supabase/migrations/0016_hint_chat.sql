--mission hint chat, every message in and out is logged (rate limiting, record)

create table mission_hint_messages (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  assignment_id uuid not null references mission_assignments(id) on delete cascade,
  member_id     uuid references family_members(id) on delete set null,

  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 2000),

  --set when moderation pass rejected or rewrote something
  blocked        boolean not null default false,
  block_reason   text,

  model      text,
  created_at timestamptz not null default now()
);

create index idx_hint_messages_assignment
  on mission_hint_messages(assignment_id, created_at);
create index idx_hint_messages_family_day
  on mission_hint_messages(family_id, created_at);

alter table mission_hint_messages enable row level security;

create policy "family can read own hint messages"
  on mission_hint_messages for select
  using (family_id = get_my_family_id());
-- o client writes at all

--how many more questions this family may ask today.
create or replace function hint_quota_remaining(p_family_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_used          integer;
  v_daily_limit   integer := 30;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id into v_caller_family
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  select count(*) into v_used
  from mission_hint_messages
  where family_id = p_family_id
    and role = 'user'
    and created_at >= date_trunc('day', now());

  return greatest(0, v_daily_limit - v_used);
end;
$$;

revoke all on function hint_quota_remaining(uuid) from public, anon;
grant execute on function hint_quota_remaining(uuid) to authenticated;