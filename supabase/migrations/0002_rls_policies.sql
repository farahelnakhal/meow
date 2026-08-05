--member can see their fam
create policy "members can view own family"
  on families for select
  using (
    id in (
      select family_id from family_members
      where auth_user_id = auth.uid()
    )
  );

--anyone authenticated can create fam
create policy "authenticated users can create a family"
  on families for insert
  with check (auth.uid() is not null);

--parent can update their own familys settings
create policy "parents can update own family"
  on families for update
  using (
    id in (
      select family_id from family_members
      where auth_user_id = auth.uid() and role = 'parent'
    )
  );

--members can view other members in own fam
create policy "members can view own family members"
  on family_members for select
  using (
    family_id in (
      select family_id from family_members
      where auth_user_id = auth.uid()
    )
  );

--authenticated user can insert themselves as a member
create policy "users can insert own member row"
  on family_members for insert
  with check (auth.uid() is not null);

--parents can update member rows within their family
create policy "parents can update family members"
  on family_members for update
  using (
    family_id in (
      select family_id from family_members
      where auth_user_id = auth.uid() and role = 'parent'
    )
  );