-- storage for mission proof photos, private bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mission-proofs', 'mission-proofs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- path convention: <family_id>/<assignment_id>-<timestamp>.jpg

drop policy if exists "family can upload own proofs" on storage.objects;
create policy "family can upload own proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mission-proofs'
    and (storage.foldername(name))[1] = get_my_family_id()::text
  );

drop policy if exists "family can read own proofs" on storage.objects;
create policy "family can read own proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'mission-proofs'
    and (storage.foldername(name))[1] = get_my_family_id()::text
  );

--no update/delete policy: a client must not be able to swap the bytes of verified submsiion