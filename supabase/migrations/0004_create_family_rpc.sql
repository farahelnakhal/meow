-- creates the family AND the parent's member row
create or replace function create_family_with_parent(
  p_family_name text,
  p_parent_name text
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

  --one family per auth user
  if exists (select 1 from family_members where auth_user_id = auth.uid()) then
    raise exception 'user already belongs to a family';
  end if;

  insert into families (name)
  values (p_family_name)
  returning id into v_family_id;

  insert into family_members (family_id, auth_user_id, display_name, role)
  values (v_family_id, auth.uid(), p_parent_name, 'parent');

  return v_family_id;
end;
$$;

revoke all on function create_family_with_parent(text, text) from public, anon;
grant execute on function create_family_with_parent(text, text) to authenticated;