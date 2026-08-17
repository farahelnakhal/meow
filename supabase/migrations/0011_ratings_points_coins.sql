--ratings + points/coins economy

create table resource_ledger (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id) on delete cascade,
  -- who earned or spent it; null for family-level adjustments.
  member_id  uuid references family_members(id) on delete set null,

  kind  text not null check (kind in ('points', 'coins')),
  -- positive = earned, negative = spent, never zero.
  delta integer not null check (delta <> 0),

  reason text not null check (reason in (
    'mission_verified',   -- trigger, on status -> verified
    'egg_contribution',   -- spent toward hatching
    'building_purchase',  -- spent on the settlement
    'animal_feed',        -- spent feeding a hatched animal
    'adjustment'          -- manual correction
  )),

  assignment_id uuid references mission_assignments(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index idx_ledger_family_kind on resource_ledger(family_id, kind);
create index idx_ledger_assignment on resource_ledger(assignment_id);

-- one award row per assignment per kind, makes double-awarding impossible 
create unique index uniq_award_per_assignment
  on resource_ledger(assignment_id, kind)
  where reason = 'mission_verified';

alter table resource_ledger enable row level security;

create policy "family can read own ledger"
  on resource_ledger for select
  using (family_id = get_my_family_id());

--no client write policies, mutations go through a security definer function

--balances. security_invoker so the underlying ledger RLS still applies
create view family_balances with (security_invoker = true) as
select
  f.id as family_id,
  coalesce(sum(l.delta) filter (where l.kind = 'points'), 0)::integer as points_balance,
  coalesce(sum(l.delta) filter (where l.kind = 'coins'),  0)::integer as coins_balance,
  coalesce(sum(l.delta) filter (where l.kind = 'points' and l.delta > 0), 0)::integer as points_earned_total,
  coalesce(sum(l.delta) filter (where l.kind = 'coins'  and l.delta > 0), 0)::integer as coins_earned_total
from families f
left join resource_ledger l on l.family_id = f.id
group by f.id;

grant select on family_balances to authenticated, service_role;

--award trigger, fires exactly once, when an assignment becomes verified
create or replace function award_on_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  --only transition INTO verified, and only once
  if new.status <> 'verified' or old.status = 'verified' then
    return new;
  end if;

  if new.points_awarded > 0 then
    insert into resource_ledger (family_id, member_id, kind, delta, reason, assignment_id)
    values (new.family_id, new.member_id, 'points', new.points_awarded, 'mission_verified', new.id)
    on conflict do nothing;
  end if;

  if new.coins_awarded > 0 then
    insert into resource_ledger (family_id, member_id, kind, delta, reason, assignment_id)
    values (new.family_id, new.member_id, 'coins', new.coins_awarded, 'mission_verified', new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_award_on_verification
  after update of status on mission_assignments
  for each row
  execute function award_on_verification();

--ratings, feedbac only deosnt reward anuthing, only at verification
create table mission_ratings (
  assignment_id uuid primary key references mission_assignments(id) on delete cascade,
  family_id     uuid not null references families(id) on delete cascade,
  member_id     uuid not null references family_members(id) on delete cascade,
  stars         smallint not null check (stars between 1 and 5),
  note          text check (note is null or length(note) <= 500),
  created_at    timestamptz not null default now()
);

create index idx_ratings_family on mission_ratings(family_id);

alter table mission_ratings enable row level security;

create policy "family can read own ratings"
  on mission_ratings for select
  using (family_id = get_my_family_id());

--client may rate, but only its own familys verified missions
create policy "family can rate own verified missions"
  on mission_ratings for insert
  with check (
    family_id = get_my_family_id()
    and exists (
      select 1 from mission_assignments a
      where a.id = assignment_id
        and a.family_id = get_my_family_id()
        and a.status = 'verified'
    )
  );

create policy "family can update own ratings"
  on mission_ratings for update
  using (family_id = get_my_family_id())
  with check (family_id = get_my_family_id());