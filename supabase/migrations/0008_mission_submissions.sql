--submissions: the photo proof plus the AI verdict

create table mission_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references mission_assignments(id) on delete cascade,
  family_id     uuid not null references families(id) on delete cascade,
  member_id     uuid not null references family_members(id) on delete cascade,

  -- path within the Supabase Storage bucket, not a public URL
  storage_path  text not null,

  -- content hash of the image, used to block resubmitting the same photo
  image_hash    text not null,

  status text not null default 'pending'
         check (status in ('pending', 'verified', 'rejected')),

  -- full model response, kept for debugging
  ai_verdict jsonb,
  ai_reason  text,
  model      text,

  created_at timestamptz not null default now()
);

create index idx_submissions_assignment on mission_submissions(assignment_id);
create index idx_submissions_family on mission_submissions(family_id);

-- duplicate photo prevention, scoped per family
create unique index uniq_verified_hash_per_family
  on mission_submissions(family_id, image_hash)
  where status = 'verified';

alter table mission_submissions enable row level security;

create policy "family can read own submissions"
  on mission_submissions for select
  using (family_id = get_my_family_id());

--no insert/update/delete policies: service_role only