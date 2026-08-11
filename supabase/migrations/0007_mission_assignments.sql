--assignments: one row per (member, mission) handed out.
create table mission_assignments (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references families(id) on delete cascade,
  mission_id        uuid not null references missions(id) on delete restrict,
  member_id         uuid not null references family_members(id) on delete cascade,
  -- resolves {X} in the mission template
  partner_member_id  uuid references family_members(id) on delete set null,
  -- resolves {Y}, only for partners_required = 2 missions
  partner2_member_id uuid references family_members(id) on delete set null,

  status text not null default 'assigned'
         check (status in ('assigned', 'submitted', 'verified', 'rejected', 'skipped')),

  points_awarded integer not null default 0 check (points_awarded >= 0),
  coins_awarded  integer not null default 0 check (coins_awarded >= 0),

  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,

  constraint partner_is_not_self  check (partner_member_id  is distinct from member_id),
  constraint partner2_is_not_self  check (partner2_member_id is distinct from member_id),
  constraint partners_are_distinct check (partner2_member_id is distinct from partner_member_id),
  -- {Y} cannot be filled without {X}
  constraint partner2_needs_partner
    check (partner2_member_id is null or partner_member_id is not null)
);

create index idx_assignments_family on mission_assignments(family_id);
create index idx_assignments_member_status on mission_assignments(member_id, status);

--one live assignment of a given mission per member, allows reassigning but not duplicates
create unique index uniq_open_assignment
  on mission_assignments(member_id, mission_id)
  where status in ('assigned', 'submitted');

alter table mission_assignments enable row level security;

create policy "family can read own assignments"
  on mission_assignments for select
  using (family_id = get_my_family_id());

--clients may only move a mission to skipped, and only within their family
create policy "family can skip own assignments"
  on mission_assignments for update
  using (
    family_id = get_my_family_id()
    -- open rows only
    and status in ('assigned', 'submitted')
  )
  with check (
    family_id = get_my_family_id()
    and status = 'skipped'
    and points_awarded = 0
    and coins_awarded = 0
  );

--no insert policy: assignments are created by assign_missions_for_family()