--engagement flags + economy tuning

create table engagement_flags (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  --member flag is about; null for whole-family patterns
  member_id uuid references family_members(id) on delete cascade,
  --for pair flags, second member
  member_b_id uuid references family_members(id) on delete cascade,

  kind text not null check (kind in (
    'inactive_member', -- has completed nothing recently
    'high_skip_rate',  -- skipping most of what they are given
    'low_ratings', -- completing but not enjoying it
    'disconnected_pair', -- two members who never do anything together
    'stalled_family' -- nobody has completed anything recently
  )),

  severity text not null default 'notice' check (severity in ('notice', 'concern')),

  --numbers behind flag, so a parent can be shown why
  evidence jsonb not null default '{}'::jsonb,
  --model-written sentence for parent. Null until phrased.
  message text,

  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),

  detected_at     timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index idx_flags_family_status on engagement_flags(family_id, status, detected_at desc);

-- One open flag of a kind per subject, so rerunning detection updates
create unique index uniq_open_flag
  on engagement_flags(family_id, kind, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(member_b_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';

alter table engagement_flags enable row level security;

create policy "family can read own flags"
  on engagement_flags for select
  using (family_id = get_my_family_id());

--caregiver may acknowledge a flag; nothing else is client-writable.
create policy "family can acknowledge own flags"
  on engagement_flags for update
  using (family_id = get_my_family_id() and status = 'open')
  with check (family_id = get_my_family_id() and status in ('acknowledged', 'resolved'));

--raw numbers per member
create view member_engagement with (security_invoker = true) as
select
  fm.family_id,
  fm.id as member_id,
  fm.display_name,
  fm.role,
  count(a.id)::integer as total_assigned,
  count(a.id) filter (where a.status = 'verified')::integer as completed,
  count(a.id) filter (where a.status = 'skipped')::integer as skipped,
  count(a.id) filter (where a.status in ('assigned', 'submitted'))::integer as still_open,
  max(a.completed_at) as last_completed_at,
  round(avg(r.stars)::numeric, 2) as avg_rating,
  count(r.assignment_id)::integer as ratings_given
from family_members fm
left join mission_assignments a on a.member_id = fm.id
left join mission_ratings r on r.assignment_id = a.id
group by fm.family_id, fm.id, fm.display_name, fm.role;

grant select on member_engagement to authenticated, service_role;

--deterministic pass, safe to run repeatedly, thresholds are deliberately conservative
create or replace function detect_engagement_flags(p_family_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_found         integer := 0;
  v_member        record;
  v_pair          record;
  v_family_last   timestamptz;
  v_member_count  integer;
  v_total_done    integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id into v_caller_family
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  select count(*) into v_member_count from family_members where family_id = p_family_id;
  select count(*) into v_total_done
  from mission_assignments where family_id = p_family_id and status = 'verified';

  --nothing meaningful to say about a family that has barely started
  if v_total_done < 3 then
    return 0;
  end if;

  --per member
  for v_member in
    select me.member_id, me.display_name, me.total_assigned, me.completed,
           me.skipped, me.last_completed_at, me.avg_rating, me.ratings_given
    from member_engagement me
    where me.family_id = p_family_id
  loop
    -- inactive is when given at least 3, completed none in 10 days
    if v_member.total_assigned >= 3
       and (v_member.last_completed_at is null
            or v_member.last_completed_at < now() - interval '10 days') then
      insert into engagement_flags (family_id, member_id, kind, severity, evidence)
      values (p_family_id, v_member.member_id, 'inactive_member',
              case when v_member.completed = 0 then 'concern' else 'notice' end,
              jsonb_build_object(
                'assigned', v_member.total_assigned,
                'completed', v_member.completed,
                'last_completed_at', v_member.last_completed_at))
      on conflict do nothing;
      v_found := v_found + 1;
    end if;

    -- skipping is when at least 5 given and more than half skipped
    if v_member.total_assigned >= 5
       and v_member.skipped::numeric / v_member.total_assigned > 0.5 then
      insert into engagement_flags (family_id, member_id, kind, severity, evidence)
      values (p_family_id, v_member.member_id, 'high_skip_rate', 'notice',
              jsonb_build_object(
                'assigned', v_member.total_assigned,
                'skipped', v_member.skipped,
                'skip_rate', round(v_member.skipped::numeric / v_member.total_assigned, 2)))
      on conflict do nothing;
      v_found := v_found + 1;
    end if;

    -- low ratings whjen at least 3 ratings averaging under 2.5 out of 5.
    if v_member.ratings_given >= 3 and v_member.avg_rating < 2.5 then
      insert into engagement_flags (family_id, member_id, kind, severity, evidence)
      values (p_family_id, v_member.member_id, 'low_ratings', 'notice',
              jsonb_build_object(
                'ratings_given', v_member.ratings_given,
                'avg_rating', v_member.avg_rating))
      on conflict do nothing;
      v_found := v_found + 1;
    end if;
  end loop;

  --disconnected pairs (meaningful later)
  if v_total_done >= 6 and v_member_count >= 3 then
    for v_pair in
      select fm1.id as a_id, fm2.id as b_id, fm1.display_name as a_name, fm2.display_name as b_name
      from family_members fm1
      join family_members fm2
        on fm2.family_id = fm1.family_id and fm2.id > fm1.id
      where fm1.family_id = p_family_id
        and not exists (
          select 1 from pair_interaction_log l
          where l.member_a = fm1.id and l.member_b = fm2.id
            and l.kind = 'verified'
        )
    loop
      insert into engagement_flags (family_id, member_id, member_b_id, kind, severity, evidence)
      values (p_family_id, v_pair.a_id, v_pair.b_id, 'disconnected_pair', 'notice',
              jsonb_build_object('a', v_pair.a_name, 'b', v_pair.b_name,
                                 'family_completed', v_total_done))
      on conflict do nothing;
      v_found := v_found + 1;
    end loop;
  end if;

  --whole family stalled
  select max(completed_at) into v_family_last
  from mission_assignments
  where family_id = p_family_id and status = 'verified';

  if v_family_last is not null and v_family_last < now() - interval '14 days' then
    insert into engagement_flags (family_id, kind, severity, evidence)
    values (p_family_id, 'stalled_family', 'concern',
            jsonb_build_object('last_completed_at', v_family_last))
    on conflict do nothing;
    v_found := v_found + 1;
  end if;

  return v_found;
end;
$$;

revoke all on function detect_engagement_flags(uuid) from public, anon;
grant execute on function detect_engagement_flags(uuid) to authenticated;

--economy tuning, stores a per family multiplier that ensure_incubating_egg and purchase_building apply
create table family_economy_tuning (
  family_id      uuid primary key references families(id) on delete cascade,
  -- 0.5 = everything costs half; 2.0 = double. Clamped on write.
  egg_multiplier      numeric(3, 2) not null default 1.00
                      check (egg_multiplier between 0.50 and 2.00),
  building_multiplier numeric(3, 2) not null default 1.00
                      check (building_multiplier between 0.50 and 2.00),
  --why it was set, for parent dashboard and for debugging
  rationale      text,
  completion_rate numeric(4, 3),
  tuned_at       timestamptz not null default now()
);

alter table family_economy_tuning enable row level security;

create policy "family can read own tuning"
  on family_economy_tuning for select
  using (family_id = get_my_family_id());
-- writes via tune_family_economy only

--completion rate in, multipliers out
create or replace function tune_family_economy(p_family_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_total       integer;
  v_completed   integer;
  v_rate        numeric;
  v_egg         numeric := 1.00;
  v_building    numeric := 1.00;
  v_reason      text;
  v_cur_egg     numeric;
  v_cur_build   numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id into v_caller_family
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  select count(*) filter (where status in ('verified', 'skipped', 'rejected')),
         count(*) filter (where status = 'verified')
    into v_total, v_completed
  from mission_assignments
  where family_id = p_family_id;

  if v_total < 8 then
    return jsonb_build_object(
      'tuned', false,
      'reason', 'not enough history yet',
      'decided_on', v_total
    );
  end if;

  v_rate := round(v_completed::numeric / v_total, 3);

  select egg_multiplier, building_multiplier into v_cur_egg, v_cur_build
  from family_economy_tuning where family_id = p_family_id;

  v_cur_egg   := coalesce(v_cur_egg, 1.00);
  v_cur_build := coalesce(v_cur_build, 1.00);

  if v_rate >= 0.80 then
    v_egg      := v_cur_egg + 0.25;
    v_building := v_cur_build + 0.25;
    v_reason   := 'finishing almost everything, so rewards cost a little more';
  elsif v_rate <= 0.35 then
    v_egg      := v_cur_egg - 0.25;
    v_building := v_cur_build - 0.25;
    v_reason   := 'finishing a smaller share, so rewards come sooner';
  else
    v_egg      := v_cur_egg;
    v_building := v_cur_build;
    v_reason   := 'pace looks about right, left unchanged';
  end if;

  --hard clamp so no runaway in either direction
  v_egg      := greatest(0.50, least(2.00, v_egg));
  v_building := greatest(0.50, least(2.00, v_building));

  insert into family_economy_tuning
    (family_id, egg_multiplier, building_multiplier, rationale, completion_rate, tuned_at)
  values (p_family_id, v_egg, v_building, v_reason, v_rate, now())
  on conflict (family_id) do update
    set egg_multiplier = excluded.egg_multiplier,
        building_multiplier = excluded.building_multiplier,
        rationale = excluded.rationale,
        completion_rate = excluded.completion_rate,
        tuned_at = now();

  return jsonb_build_object(
    'tuned', true,
    'completion_rate', v_rate,
    'egg_multiplier', v_egg,
    'building_multiplier', v_building,
    'rationale', v_reason,
    'decided_on', v_total
  );
end;
$$;

revoke all on function tune_family_economy(uuid) from public, anon;
grant execute on function tune_family_economy(uuid) to authenticated;

--applies egg multiplier
create or replace function ensure_incubating_egg(p_family_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_egg_id        uuid;
  v_owned         integer;
  v_required      integer;
  v_mult          numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select family_id into v_caller_family
  from family_members where auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  select id into v_egg_id
  from family_eggs
  where family_id = p_family_id and status = 'incubating'
  limit 1;

  if v_egg_id is not null then
    return v_egg_id;
  end if;

  select count(*) into v_owned from family_animals where family_id = p_family_id;

  select egg_multiplier into v_mult
  from family_economy_tuning where family_id = p_family_id;
  v_mult := coalesce(v_mult, 1.00);

  --base 100, +50 per animal owned, capped, then tuned, floor of 25 so heavily discounted egg is still worth reaching
  v_required := greatest(25, round(least(100 + (v_owned * 50), 500) * v_mult)::integer);

  insert into family_eggs (family_id, points_required)
  values (p_family_id, v_required)
  returning id into v_egg_id;

  return v_egg_id;
end;
$$;

revoke all on function ensure_incubating_egg(uuid) from public, anon;
grant execute on function ensure_incubating_egg(uuid) to authenticated;

-- one place that knows tuned price, so view and purchase function can never disagree
create or replace function effective_building_cost(p_family_id uuid, p_base integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(5, round(p_base * coalesce(
    (select t.building_multiplier from family_economy_tuning t where t.family_id = p_family_id),
    1.00
  ))::integer);
$$;

revoke all on function effective_building_cost(uuid, integer) from public, anon;
grant execute on function effective_building_cost(uuid, integer) to authenticated;

--must show tuned price, not base one
drop view if exists available_buildings;

create view available_buildings with (security_invoker = true) as
select
  bt.key,
  bt.label,
  bt.description,
  effective_building_cost(f.id, bt.coin_cost) as coin_cost,
  bt.coin_cost as base_coin_cost,
  bt.image_key,
  bt.sort_order,
  f.id as family_id,
  exists (
    select 1 from family_buildings fb
    where fb.family_id = f.id and fb.building_key = bt.key
  ) as already_built,
  (bt.unlock_after is null or exists (
    select 1 from family_buildings fb
    where fb.family_id = f.id and fb.building_key = bt.unlock_after
  )) as unlocked
from building_types bt
cross join families f
where bt.active;

grant select on available_buildings to authenticated, service_role;

--charges tuned price
create or replace function purchase_building(
  p_family_id    uuid,
  p_building_key text,
  p_grid_x       smallint,
  p_grid_y       smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_member_id     uuid;
  v_label         text;
  v_base          integer;
  v_cost          integer;
  v_unlock_after  text;
  v_balance       integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id, fm.id into v_caller_family, v_member_id
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  select bt.label, bt.coin_cost, bt.unlock_after
    into v_label, v_base, v_unlock_after
  from building_types bt
  where bt.key = p_building_key and bt.active;

  if v_label is null then
    raise exception 'unknown building %', p_building_key;
  end if;

  if p_grid_x is null or p_grid_y is null
     or p_grid_x < 0 or p_grid_x > 5 or p_grid_y < 0 or p_grid_y > 5 then
    raise exception 'grid position out of range';
  end if;

  perform 1 from families f where f.id = p_family_id for update;

  if exists (select 1 from family_buildings fb
             where fb.family_id = p_family_id and fb.building_key = p_building_key) then
    raise exception 'you already built the %', v_label;
  end if;

  if v_unlock_after is not null
     and not exists (select 1 from family_buildings fb
                     where fb.family_id = p_family_id and fb.building_key = v_unlock_after) then
    raise exception 'build the % first', (select bt.label from building_types bt where bt.key = v_unlock_after);
  end if;

  if exists (select 1 from family_buildings fb
             where fb.family_id = p_family_id
               and fb.grid_x = p_grid_x and fb.grid_y = p_grid_y) then
    raise exception 'that spot is taken';
  end if;

  --single source of truth for price, shared with available_buildings
  v_cost := effective_building_cost(p_family_id, v_base);

  select coalesce(sum(l.delta), 0) into v_balance
  from resource_ledger l
  where l.family_id = p_family_id and l.kind = 'coins';

  if v_balance < v_cost then
    raise exception 'not enough coins: balance %, need %', v_balance, v_cost;
  end if;

  insert into resource_ledger (family_id, member_id, kind, delta, reason)
  values (p_family_id, v_member_id, 'coins', -v_cost, 'building_purchase');

  insert into family_buildings (family_id, building_key, grid_x, grid_y, built_by)
  values (p_family_id, p_building_key, p_grid_x, p_grid_y, v_member_id);

  select coalesce(sum(l.delta), 0) into v_balance
  from resource_ledger l
  where l.family_id = p_family_id and l.kind = 'coins';

  return jsonb_build_object(
    'building_key', p_building_key,
    'label', v_label,
    'grid_x', p_grid_x,
    'grid_y', p_grid_y,
    'coins_spent', v_cost,
    'coins_balance', v_balance
  );
end;
$$;

revoke all on function purchase_building(uuid, text, smallint, smallint) from public, anon;
grant execute on function purchase_building(uuid, text, smallint, smallint) to authenticated;

--BUGFIX: solo missions could never be assigned
alter table mission_assignments drop constraint if exists partners_are_distinct;

alter table mission_assignments
  add constraint partners_are_distinct check (
    partner_member_id is null
    or partner2_member_id is null
    or partner_member_id <> partner2_member_id
  );