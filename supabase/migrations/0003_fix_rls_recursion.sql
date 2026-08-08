--drop the recursive policies
drop policy if exists "members can view own family members" on family_members;
drop policy if exists "parents can update family members" on family_members;
drop policy if exists "members can view own family" on families;
drop policy if exists "parents can update own family" on families;

--helper function: bypasses RLS internally (security definer)
create or replace function get_my_family_id()
returns uuid
language sql
security definer
stable
as $$
  select family_id from family_members
  where auth_user_id = auth.uid()
  limit 1;
$$;

--recreate policies using the helper function instead of selfreferencing subqueries
create policy "members can view own family"
  on families for select
  using (id = get_my_family_id());

create policy "parents can update own family"
  on families for update
  using (
    id = get_my_family_id()
    and exists (
      select 1 from family_members
      where auth_user_id = auth.uid() and role = 'parent'
    )
  );

create policy "members can view own family members"
  on family_members for select
  using (family_id = get_my_family_id());

create policy "parents can update family members"
  on family_members for update
  using (
    family_id = get_my_family_id()
    and exists (
      select 1 from family_members
      where auth_user_id = auth.uid() and role = 'parent'
    )
  );
