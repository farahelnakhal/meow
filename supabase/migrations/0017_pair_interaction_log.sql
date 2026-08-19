--pair interaction log + pair-biased assignment

create table pair_interaction_log (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,

  -- canonical ordering; member_a is always the lower uuid, so (x,y) and (y,x) r same row
  member_a      uuid not null references family_members(id) on delete cascade,
  member_b      uuid not null references family_members(id) on delete cascade,

  assignment_id uuid references mission_assignments(id) on delete set null,

  -- 'assigned' = they were put together; 'verified' = they actually did it.
  kind text not null check (kind in ('assigned', 'verified')),
  weight numeric(4, 2) not null check (weight > 0),

  occurred_at timestamptz not null default now(),

  constraint pair_is_ordered check (member_a < member_b),
  constraint pair_not_self check (member_a <> member_b)
);

create index idx_pair_log_family on pair_interaction_log(family_id, occurred_at desc);
create index idx_pair_log_pair on pair_interaction_log(member_a, member_b, occurred_at desc);

alter table pair_interaction_log enable row level security;

create policy "family can read own pair log"
  on pair_interaction_log for select
  using (family_id = get_my_family_id());
-- writes come from triggers only

--LOWER -> "pair these two sooner".
--never paired (-1, paired recently (event wait), paired long ago (decays toward 0)
create or replace function pair_bias_score(p_a uuid, p_b uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1 from pair_interaction_log l
      where l.member_a = least(p_a, p_b)
        and l.member_b = greatest(p_a, p_b)
    )
      then -1::numeric
    else coalesce((
      select sum(
        l.weight / (1 + greatest(0, extract(epoch from (now() - l.occurred_at)) / 86400.0))
      )
      from pair_interaction_log l
      where l.member_a = least(p_a, p_b)
        and l.member_b = greatest(p_a, p_b)
    ), 0::numeric)
  end;
$$;

revoke all on function pair_bias_score(uuid, uuid) from public, anon;
grant execute on function pair_bias_score(uuid, uuid) to authenticated;

-- records pairing when a mission is handed out, covers {X}. {Y}, and X-Y pair
create or replace function log_pair_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.partner_member_id is null then
    return new;
  end if;

  insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight)
  values (
    new.family_id,
    least(new.member_id, new.partner_member_id),
    greatest(new.member_id, new.partner_member_id),
    new.id, 'assigned', 0.5
  );

  if new.partner2_member_id is not null then
    -- member with partner2
    insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight)
    values (
      new.family_id,
      least(new.member_id, new.partner2_member_id),
      greatest(new.member_id, new.partner2_member_id),
      new.id, 'assigned', 0.5
    );
    -- and the two partners with each other
    insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight)
    values (
      new.family_id,
      least(new.partner_member_id, new.partner2_member_id),
      greatest(new.partner_member_id, new.partner2_member_id),
      new.id, 'assigned', 0.5
    );
  end if;

  return new;
end;
$$;

create trigger trg_log_pair_on_assignment
  after insert on mission_assignments
  for each row
  execute function log_pair_on_assignment();

--completed mission is stronger evidence that pair spent time together
create or replace function log_pair_on_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'verified' or old.status = 'verified' then
    return new;
  end if;
  if new.partner_member_id is null then
    return new;
  end if;

  insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight)
  values (
    new.family_id,
    least(new.member_id, new.partner_member_id),
    greatest(new.member_id, new.partner_member_id),
    new.id, 'verified', 1.0
  );

  if new.partner2_member_id is not null then
    insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight)
    values (
      new.family_id,
      least(new.member_id, new.partner2_member_id),
      greatest(new.member_id, new.partner2_member_id),
      new.id, 'verified', 1.0
    );
    insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight)
    values (
      new.family_id,
      least(new.partner_member_id, new.partner2_member_id),
      greatest(new.partner_member_id, new.partner2_member_id),
      new.id, 'verified', 1.0
    );
  end if;

  return new;
end;
$$;

create trigger trg_log_pair_on_verification
  after update of status on mission_assignments
  for each row
  execute function log_pair_on_verification();

--backfill from existing assignments so log is not empty on day one
insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight, occurred_at)
select a.family_id,
       least(a.member_id, a.partner_member_id),
       greatest(a.member_id, a.partner_member_id),
       a.id, 'assigned', 0.5, a.assigned_at
from mission_assignments a
where a.partner_member_id is not null
  and a.member_id <> a.partner_member_id;

insert into pair_interaction_log (family_id, member_a, member_b, assignment_id, kind, weight, occurred_at)
select a.family_id,
       least(a.member_id, a.partner_member_id),
       greatest(a.member_id, a.partner_member_id),
       a.id, 'verified', 1.0, coalesce(a.completed_at, a.assigned_at)
from mission_assignments a
where a.partner_member_id is not null
  and a.member_id <> a.partner_member_id
  and a.status = 'verified';

create view pair_overview with (security_invoker = true) as
select
  l.family_id,
  l.member_a,
  l.member_b,
  count(*)::integer as interactions,
  count(*) filter (where l.kind = 'verified')::integer as completed_together,
  max(l.occurred_at) as last_together
from pair_interaction_log l
group by l.family_id, l.member_a, l.member_b;

grant select on pair_overview to authenticated, service_role;