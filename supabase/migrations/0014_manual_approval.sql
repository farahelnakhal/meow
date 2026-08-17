--make verification survivable; human path to rejected demo

--how a submission was decided: 'ai' or 'caregiver'.
alter table mission_submissions
  add column if not exists decided_by text not null default 'ai'
  check (decided_by in ('ai', 'caregiver'));

--which member approved it, when decided_by = 'caregiver'
alter table mission_submissions
  add column if not exists approved_by uuid references family_members(id) on delete set null;

--parent/caregiver only
create or replace function approve_submission_manually(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_caller_id     uuid;
  v_caller_role   text;
  v_family_id     uuid;
  v_status        text;
  v_points        integer;
  v_coins         integer;
  v_submission_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id, fm.id, fm.role
    into v_caller_family, v_caller_id, v_caller_role
  from family_members fm
  where fm.auth_user_id = auth.uid()
  limit 1;

  if v_caller_family is null then
    raise exception 'no family for this account';
  end if;

  if v_caller_role not in ('parent', 'caregiver') then
    raise exception 'only a parent or caregiver can approve a mission';
  end if;

  select a.family_id, a.status, m.points, m.coins
    into v_family_id, v_status, v_points, v_coins
  from mission_assignments a
  join missions m on m.id = a.mission_id
  where a.id = p_assignment_id
  for update;

  if v_family_id is null then
    raise exception 'assignment not found';
  end if;
  if v_family_id is distinct from v_caller_family then
    raise exception 'not your family''s mission';
  end if;
  if v_status = 'verified' then
    raise exception 'this mission is already complete';
  end if;
  if v_status = 'skipped' then
    raise exception 'this mission was skipped';
  end if;

  -- attach approval to most recent submission if one exists
  select s.id into v_submission_id
  from mission_submissions s
  where s.assignment_id = p_assignment_id
  order by s.created_at desc
  limit 1;

  if v_submission_id is not null then
    update mission_submissions s
    set status = 'verified',
        decided_by = 'caregiver',
        approved_by = v_caller_id,
        ai_reason = coalesce(s.ai_reason, '') || ' [approved by caregiver]'
    where s.id = v_submission_id;
  end if;

  -- award trigger fires on this, so points are granted by same path as ai
  update mission_assignments a
  set status = 'verified',
      points_awarded = v_points,
      coins_awarded = v_coins,
      completed_at = now()
  where a.id = p_assignment_id;

  return jsonb_build_object(
    'verified', true,
    'decided_by', 'caregiver',
    'points', v_points,
    'coins', v_coins
  );
end;
$$;

revoke all on function approve_submission_manually(uuid) from public, anon;
grant execute on function approve_submission_manually(uuid) to authenticated;