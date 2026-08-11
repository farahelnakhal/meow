
--v1 assignment: deterministic filtering + interest-weighted ranking, no AI call

-- security definer because it must read mission_skill_map and family_profile_private
create or replace function assign_missions_for_family(
  p_family_id  uuid, --refuses other fam id
  p_per_member integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_max_budget    numeric;
  v_games         text[];
  v_has_pets      boolean;
  v_member_count  integer;
  v_member        record;
  v_mission       record;
  v_partner       uuid;
  v_partner2      uuid;
  v_age           integer;
  v_this_year     integer := extract(year from now())::integer;
  v_inserted      integer := 0;
  v_rows          integer;
  v_parent_id     uuid;
  v_skill_focus   text[];
  v_open_skill    integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select family_id into v_caller_family
  from family_members
  where auth_user_id = auth.uid()
  limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  --client cannot ask for 10000 missions
  p_per_member := greatest(1, least(coalesce(p_per_member, 3), 10));

  select max_budget, coalesce(games_owned, '{}'::text[]), has_pets
    into v_max_budget, v_games, v_has_pets
  from families
  where id = p_family_id;

  select count(*) into v_member_count
  from family_members
  where family_id = p_family_id;

  --ordinary missions per member
  for v_member in
    select id, role, birth_year
    from family_members
    where family_id = p_family_id
    order by created_at
  loop
    --members with no birth_year are treated as 30-year-old adults
    v_age := v_this_year - coalesce(v_member.birth_year, v_this_year - 30);

    for v_mission in
      select m.id, m.partners_required
      from missions m
      left join member_interests mi
        on mi.member_id = v_member.id
       and mi.category_key = m.category_key
      where m.active
        and m.est_cost <= v_max_budget
        and v_age between m.min_age and m.max_age
        and (m.requires_game is null or m.requires_game = any(v_games))
        and (not m.requires_pet or v_has_pets)
        -- needs a real named venue; deferred to the locations feature
        and not m.needs_location
        -- enough OTHER members to fill {X} and {Y}
        and (v_member_count - 1) >= m.partners_required
        -- hidden skill missions are scheduled separately, never in the open pool
        and not exists (
          select 1 from mission_skill_map sm where sm.mission_id = m.id
        )
        -- never re-assign something open or already completed
        and not exists (
          select 1 from mission_assignments a
          where a.member_id = v_member.id
            and a.mission_id = m.id
            and a.status in ('assigned', 'submitted', 'verified')
        )
      order by coalesce(mi.weight, 1) desc, random()
      limit p_per_member
    loop
      v_partner  := null;
      v_partner2 := null;

      if v_mission.partners_required >= 1 then
        -- least-paired partner first (temp, pending pair bias model)
        select fm.id into v_partner
        from family_members fm
        where fm.family_id = p_family_id
          and fm.id <> v_member.id
        order by (
          select count(*)
          from mission_assignments a
          where (a.member_id = v_member.id and a.partner_member_id = fm.id)
             or (a.member_id = fm.id and a.partner_member_id = v_member.id)
        ) asc, random()
        limit 1;

        if v_partner is null then
          continue;
        end if;
      end if;

      if v_mission.partners_required = 2 then
        select fm.id into v_partner2
        from family_members fm
        where fm.family_id = p_family_id
          and fm.id <> v_member.id
          and fm.id <> v_partner
        order by random()
        limit 1;

        if v_partner2 is null then
          continue;
        end if;
      end if;

      insert into mission_assignments
        (family_id, mission_id, member_id, partner_member_id, partner2_member_id)
      values
        (p_family_id, v_mission.id, v_member.id, v_partner, v_partner2)
      on conflict do nothing;

      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end loop;
  end loop;

  -- hidden skill mission: caregivers only, one open at a time
  select id into v_parent_id
  from family_members
  where family_id = p_family_id
    and role in ('parent', 'caregiver')
  order by case when role = 'parent' then 0 else 1 end, created_at
  limit 1;

  if v_parent_id is not null then
    select skill_focus into v_skill_focus
    from family_profile_private
    where family_id = p_family_id;

    if v_skill_focus is not null and array_length(v_skill_focus, 1) > 0 then
      select count(*) into v_open_skill
      from mission_assignments a
      join mission_skill_map sm on sm.mission_id = a.mission_id
      where a.member_id = v_parent_id
        and a.status in ('assigned', 'submitted');

      if v_open_skill = 0 then
        select m.id, m.partners_required into v_mission
        from missions m
        join mission_skill_map sm on sm.mission_id = m.id
        where m.active
          and sm.skill_target = any(v_skill_focus)
          and m.est_cost <= v_max_budget
          and (m.requires_game is null or m.requires_game = any(v_games))
          and (not m.requires_pet or v_has_pets)
          and not m.needs_location
          and (v_member_count - 1) >= m.partners_required
          and not exists (
            select 1 from mission_assignments a
            where a.member_id = v_parent_id
              and a.mission_id = m.id
              and a.status in ('assigned', 'submitted', 'verified')
          )
        order by sm.sequence_hint asc, random()
        limit 1;

        if v_mission.id is not null then
          v_partner  := null;
          v_partner2 := null;

          if v_mission.partners_required >= 1 then
            -- a skill mission targets the caregiver-child relationship, so
            -- bias {X} toward a child rather than another adult
            select fm.id into v_partner
            from family_members fm
            where fm.family_id = p_family_id
              and fm.id <> v_parent_id
            order by case when fm.role = 'child' then 0 else 1 end, random()
            limit 1;
          end if;

          if v_mission.partners_required = 2 then
            select fm.id into v_partner2
            from family_members fm
            where fm.family_id = p_family_id
              and fm.id <> v_parent_id
              and fm.id <> v_partner
            order by random()
            limit 1;
          end if;

          if (v_mission.partners_required = 0)
             or (v_mission.partners_required = 1 and v_partner is not null)
             or (v_mission.partners_required = 2 and v_partner2 is not null)
          then
            insert into mission_assignments
              (family_id, mission_id, member_id, partner_member_id, partner2_member_id)
            values
              (p_family_id, v_mission.id, v_parent_id, v_partner, v_partner2)
            on conflict do nothing;

            get diagnostics v_rows = row_count;
            v_inserted := v_inserted + v_rows;
          end if;
        end if;
      end if;
    end if;
  end if;

  return v_inserted;
end;
$$;

revoke all on function assign_missions_for_family(uuid, integer) from public, anon;
grant execute on function assign_missions_for_family(uuid, integer) to authenticated;