--family polls, caregiver creates a poll with 2-6 options; every family member votes once

create table polls (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  created_by  uuid references family_members(id) on delete set null,
  question    text not null check (length(trim(question)) between 3 and 200),
  status      text not null default 'open' check (status in ('open', 'closed')),
  --set when poll closes; winning option, resolved at close time
  winning_option_id uuid,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,

  constraint closed_has_timestamp check (
    (status = 'open'   and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create index idx_polls_family on polls(family_id, status);

--at most one open poll per family, so feed is never ambiguous
create unique index uniq_open_poll_per_family
  on polls(family_id) where status = 'open';

alter table polls enable row level security;

create policy "family can read own polls"
  on polls for select
  using (family_id = get_my_family_id());
--writes via functions only

create table poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references polls(id) on delete cascade,
  label       text not null check (length(trim(label)) between 1 and 120),
  -- optional AI-suggested detail, e.g. why this fits the family
  detail      text check (detail is null or length(detail) <= 300),
  sort_order  smallint not null,

  unique (poll_id, sort_order)
);

create index idx_poll_options_poll on poll_options(poll_id);

alter table poll_options enable row level security;

create policy "family can read options for own polls"
  on poll_options for select
  using (exists (
    select 1 from polls p
    where p.id = poll_id and p.family_id = get_my_family_id()
  ));

create table poll_votes (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references polls(id) on delete cascade,
  option_id  uuid not null references poll_options(id) on delete cascade,
  member_id  uuid not null references family_members(id) on delete cascade,
  family_id  uuid not null references families(id) on delete cascade,
  created_at timestamptz not null default now(),

  --one vote per member per poll, enforced in storage not application logic
  unique (poll_id, member_id)
);

create index idx_poll_votes_poll on poll_votes(poll_id);

alter table poll_votes enable row level security;

create policy "family can read own votes"
  on poll_votes for select
  using (family_id = get_my_family_id());
--writes via cast_poll_vote only, so option/poll consistency is guaranteed

-- poll results tally with vote counts, security_invoker so poll RLS applies
create view poll_results with (security_invoker = true) as
select
  o.poll_id,
  o.id as option_id,
  o.label,
  o.detail,
  o.sort_order,
  count(v.id)::integer as votes
from poll_options o
left join poll_votes v on v.option_id = o.id
group by o.poll_id, o.id, o.label, o.detail, o.sort_order;

grant select on poll_results to authenticated, service_role;

-- create_poll for caregiver only
create or replace function create_poll(
  p_family_id uuid,
  p_question  text,
  p_options   text[],
  p_details   text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_caller_id     uuid;
  v_caller_role   text;
  v_poll_id       uuid;
  v_count         integer;
  i               integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id, fm.id, fm.role
    into v_caller_family, v_caller_id, v_caller_role
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  if v_caller_role not in ('parent', 'caregiver') then
    raise exception 'only a parent or caregiver can create a poll';
  end if;

  if p_question is null or length(trim(p_question)) < 3 then
    raise exception 'the question is too short';
  end if;

  v_count := coalesce(array_length(p_options, 1), 0);
  if v_count < 2 or v_count > 6 then
    raise exception 'a poll needs between 2 and 6 options, got %', v_count;
  end if;

  --one open poll at a time; close the previous one rather than failing
  update polls
  set status = 'closed', closed_at = now()
  where family_id = p_family_id and status = 'open';

  insert into polls (family_id, created_by, question)
  values (p_family_id, v_caller_id, trim(p_question))
  returning id into v_poll_id;

  for i in 1..v_count loop
    if length(trim(p_options[i])) = 0 then
      raise exception 'option % is blank', i;
    end if;
    insert into poll_options (poll_id, label, detail, sort_order)
    values (
      v_poll_id,
      trim(p_options[i]),
      case when p_details is not null and array_length(p_details, 1) >= i
           then nullif(trim(p_details[i]), '') else null end,
      i
    );
  end loop;

  return jsonb_build_object('poll_id', v_poll_id, 'option_count', v_count);
end;
$$;

revoke all on function create_poll(uuid, text, text[], text[]) from public, anon;
grant execute on function create_poll(uuid, text, text[], text[]) to authenticated;

--any member may vote once, revoting changes the choice
create or replace function cast_poll_vote(
  p_option_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_poll_id       uuid;
  v_poll_family   uuid;
  v_poll_status   text;
  v_member_family uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id into v_caller_family
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null then
    raise exception 'no family for this account';
  end if;

  select o.poll_id, p.family_id, p.status
    into v_poll_id, v_poll_family, v_poll_status
  from poll_options o
  join polls p on p.id = o.poll_id
  where o.id = p_option_id;

  if v_poll_id is null then
    raise exception 'option not found';
  end if;
  if v_poll_family is distinct from v_caller_family then
    raise exception 'not your family''s poll';
  end if;
  if v_poll_status <> 'open' then
    raise exception 'this poll is closed';
  end if;

  -- the voter must be a member of the same family
  select fm.family_id into v_member_family
  from family_members fm where fm.id = p_member_id;

  if v_member_family is distinct from v_caller_family then
    raise exception 'that member is not in your family';
  end if;

  insert into poll_votes (poll_id, option_id, member_id, family_id)
  values (v_poll_id, p_option_id, p_member_id, v_caller_family)
  on conflict (poll_id, member_id)
  do update set option_id = excluded.option_id, created_at = now();

  return jsonb_build_object('poll_id', v_poll_id, 'option_id', p_option_id);
end;
$$;

revoke all on function cast_poll_vote(uuid, uuid) from public, anon;
grant execute on function cast_poll_vote(uuid, uuid) to authenticated;

-- ============================================================
-- close_poll: caregiver only. Resolves the winner; ties break by sort_order
-- so the result is deterministic rather than arbitrary.
-- ============================================================
create or replace function close_poll(p_poll_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_caller_role   text;
  v_poll_family   uuid;
  v_poll_status   text;
  v_winner        uuid;
  v_label         text;
  v_votes         integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id, fm.role into v_caller_family, v_caller_role
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_role not in ('parent', 'caregiver') then
    raise exception 'only a parent or caregiver can close a poll';
  end if;

  select p.family_id, p.status into v_poll_family, v_poll_status
  from polls p where p.id = p_poll_id for update;

  if v_poll_family is null then
    raise exception 'poll not found';
  end if;
  if v_poll_family is distinct from v_caller_family then
    raise exception 'not your family''s poll';
  end if;
  if v_poll_status = 'closed' then
    raise exception 'this poll is already closed';
  end if;

  select o.id, o.label, count(v.id)::integer
    into v_winner, v_label, v_votes
  from poll_options o
  left join poll_votes v on v.option_id = o.id
  where o.poll_id = p_poll_id
  group by o.id, o.label, o.sort_order
  order by count(v.id) desc, o.sort_order asc
  limit 1;

  update polls
  set status = 'closed', closed_at = now(), winning_option_id = v_winner
  where id = p_poll_id;

  return jsonb_build_object(
    'poll_id', p_poll_id,
    'winning_option_id', v_winner,
    'winning_label', v_label,
    'votes', coalesce(v_votes, 0)
  );
end;
$$;

revoke all on function close_poll(uuid) from public, anon;
grant execute on function close_poll(uuid) to authenticated;

-- winning_option_id points at an option; added after poll_options exists
alter table polls
  add constraint polls_winning_option_fkey
  foreign key (winning_option_id) references poll_options(id) on delete set null;