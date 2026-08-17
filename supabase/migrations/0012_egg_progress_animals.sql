--eggs and animal collection

create table animals (
  id           uuid primary key default gen_random_uuid(),
  species      text not null unique,
  common_name  text not null,
  -- 1 common, 2 uncommon, 3 rare, 4 legendary (lower -> more likely)
  rarity       smallint not null check (rarity between 1 and 4),
  -- relative draw weight within the pool; higher -> more likely
  draw_weight  integer not null default 100 check (draw_weight > 0),
  habitat      text not null,
  fun_fact     text not null,
  --asset key app maps to local image; no remote URLs
  image_key    text not null,
  conservation_partner text,
  active       boolean not null default true
);

alter table animals enable row level security;

create policy "signed in users can read animals"
  on animals for select
  using (auth.uid() is not null and active);

insert into animals (species, common_name, rarity, draw_weight, habitat, fun_fact, image_key) values
  ('vulpes_vulpes',      'Red Fox',          1, 200, 'Woodland and city edges', 'A fox can hear a mouse moving under snow.',                 'fox'),
  ('erinaceus',          'Hedgehog',         1, 200, 'Hedgerows and gardens',   'Hedgehogs have around 5,000 spines, and lose them like hair.', 'hedgehog'),
  ('sciurus',            'Squirrel',         1, 200, 'Parks and forests',       'Squirrels plant thousands of trees by forgetting where they buried nuts.', 'squirrel'),
  ('felis_catus',        'Sand Cat',         2, 120, 'Deserts',                 'Sand cats can survive without drinking water for weeks.',   'sandcat'),
  ('chelonia_mydas',     'Green Sea Turtle', 2, 120, 'Warm coastal seas',       'Green turtles return to the beach where they hatched to nest.', 'turtle'),
  ('phoenicopterus',     'Flamingo',         2, 120, 'Salt lakes and lagoons',  'Flamingos are grey when young; their food turns them pink.', 'flamingo'),
  ('panthera_pardus',    'Arabian Leopard',  3,  50, 'Rocky mountains',         'Fewer than 200 Arabian leopards are thought to remain in the wild.', 'leopard'),
  ('oryx_leucoryx',      'Arabian Oryx',     3,  50, 'Desert plains',           'The Arabian oryx was extinct in the wild and was brought back by breeding programmes.', 'oryx'),
  ('dugong_dugon',       'Dugong',           3,  50, 'Shallow seagrass beds',   'Dugongs are the likely origin of old sailors'' mermaid stories.', 'dugong'),
  ('ailuropoda',         'Giant Panda',      4,  15, 'Bamboo forests',          'A giant panda eats bamboo for up to 14 hours a day.',       'panda'),
  ('phocoena_sinus',     'Vaquita',          4,  10, 'Gulf of California',      'The vaquita is the rarest marine mammal on Earth.',         'vaquita');

--one incubating egg per family at a time
create table family_eggs (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references families(id) on delete cascade,
  points_required    integer not null check (points_required > 0),
  points_contributed integer not null default 0 check (points_contributed >= 0),
  status             text not null default 'incubating'
                     check (status in ('incubating', 'hatched')),
  --set only on hatch
  animal_id          uuid references animals(id) on delete set null,
  created_at         timestamptz not null default now(),
  hatched_at         timestamptz,

  constraint egg_not_overfilled check (points_contributed <= points_required),
  constraint hatched_has_animal check (
    (status = 'incubating' and animal_id is null and hatched_at is null)
    or (status = 'hatched' and animal_id is not null and hatched_at is not null)
  )
);

create index idx_eggs_family on family_eggs(family_id);

-- at most one incubating egg per family
create unique index uniq_incubating_egg_per_family
  on family_eggs(family_id) where status = 'incubating';

alter table family_eggs enable row level security;

create policy "family can read own eggs"
  on family_eggs for select
  using (family_id = get_my_family_id());
-- writes via functions only

--natched animals the family owns
create table family_animals (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  animal_id    uuid not null references animals(id) on delete restrict,
  egg_id       uuid references family_eggs(id) on delete set null,
  nickname     text check (nickname is null or length(nickname) between 1 and 40),
  hatched_at   timestamptz not null default now(),
  last_fed_at  timestamptz,
  times_fed    integer not null default 0 check (times_fed >= 0)
);

create index idx_family_animals_family on family_animals(family_id);

alter table family_animals enable row level security;

create policy "family can read own animals"
  on family_animals for select
  using (family_id = get_my_family_id());

--renaming is only field client may change directly
create policy "family can rename own animals"
  on family_animals for update
  using (family_id = get_my_family_id())
  with check (family_id = get_my_family_id());

-- idempotent, creates the familys egg if absent, cost scales w how many animals fam has
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
  -- 100, 150, 200, ... capped so it stays reachable
  v_required := least(100 + (v_owned * 50), 500);

  insert into family_eggs (family_id, points_required)
  values (p_family_id, v_required)
  returning id into v_egg_id;

  return v_egg_id;
end;
$$;

revoke all on function ensure_incubating_egg(uuid) from public, anon;
grant execute on function ensure_incubating_egg(uuid) to authenticated;

--spends points from the balance into the egg
create or replace function contribute_points_to_egg(
  p_family_id uuid,
  p_points    integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_member_id     uuid;
  v_balance       integer;
  v_egg_id        uuid;
  v_contributed   integer;
  v_required      integer;
  v_spend         integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id, fm.id into v_caller_family, v_member_id
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  if p_points is null or p_points <= 0 then
    raise exception 'contribution must be positive';
  end if;

  -- lock the egg row so two devices cannot both spend the last points
  select e.id, e.points_contributed, e.points_required
    into v_egg_id, v_contributed, v_required
  from family_eggs e
  where e.family_id = p_family_id and e.status = 'incubating'
  for update;

  if v_egg_id is null then
    raise exception 'no incubating egg; call ensure_incubating_egg first';
  end if;

  -- Clamp to what the egg still needs FIRST, then check affordability against amount
  v_spend := least(p_points, v_required - v_contributed);

  if v_spend <= 0 then
    raise exception 'egg is already full; hatch it first';
  end if;

  select coalesce(sum(l.delta), 0) into v_balance
  from resource_ledger l
  where l.family_id = p_family_id and l.kind = 'points';

  if v_balance < v_spend then
    raise exception 'not enough points: balance %, need %', v_balance, v_spend;
  end if;

  insert into resource_ledger (family_id, member_id, kind, delta, reason)
  values (p_family_id, v_member_id, 'points', -v_spend, 'egg_contribution');

  update family_eggs e
  set points_contributed = e.points_contributed + v_spend
  where e.id = v_egg_id
  returning e.points_contributed into v_contributed;

  select coalesce(sum(l.delta), 0) into v_balance
  from resource_ledger l
  where l.family_id = p_family_id and l.kind = 'points';

  return jsonb_build_object(
    'egg_id', v_egg_id,
    'points_contributed', v_contributed,
    'points_required', v_required,
    'ready_to_hatch', v_contributed >= v_required,
    'points_balance', v_balance
  );
end;
$$;

revoke all on function contribute_points_to_egg(uuid, integer) from public, anon;
grant execute on function contribute_points_to_egg(uuid, integer) to authenticated;

--rarity weighted draw, then records animal
create or replace function hatch_egg(p_family_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_egg_id        uuid;
  v_contributed   integer;
  v_required      integer;
  v_pick          uuid;
  v_total         bigint;
  v_roll          bigint;
  v_result        jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select family_id into v_caller_family
  from family_members where auth_user_id = auth.uid() limit 1;

  if v_caller_family is null or v_caller_family is distinct from p_family_id then
    raise exception 'not a member of this family';
  end if;

  select e.id, e.points_contributed, e.points_required
    into v_egg_id, v_contributed, v_required
  from family_eggs e
  where e.family_id = p_family_id and e.status = 'incubating'
  for update;

  if v_egg_id is null then
    raise exception 'no incubating egg to hatch';
  end if;

  if v_contributed < v_required then
    raise exception 'egg needs % more points', v_required - v_contributed;
  end if;

  --walk cumulative weights until the roll is covered
  select coalesce(sum(a.draw_weight), 0) into v_total from animals a where a.active;
  if v_total <= 0 then
    raise exception 'no animals available to hatch';
  end if;

  v_roll := floor(random() * v_total)::bigint;

  select w.id into v_pick from (
    select a.id, sum(a.draw_weight) over (order by a.rarity, a.species) as cume
    from animals a where a.active
  ) w
  where w.cume > v_roll
  order by w.cume
  limit 1;

  update family_eggs e
  set status = 'hatched', animal_id = v_pick, hatched_at = now()
  where e.id = v_egg_id;

  insert into family_animals (family_id, animal_id, egg_id)
  values (p_family_id, v_pick, v_egg_id);

  select jsonb_build_object(
    'animal_id', a.id,
    'common_name', a.common_name,
    'rarity', a.rarity,
    'habitat', a.habitat,
    'fun_fact', a.fun_fact,
    'image_key', a.image_key
  ) into v_result
  from animals a where a.id = v_pick;

  return v_result;
end;
$$;

revoke all on function hatch_egg(uuid) from public, anon;
grant execute on function hatch_egg(uuid) to authenticated;

--small coin sink that gives collection something to do
create or replace function feed_animal(p_family_animal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_family uuid;
  v_member_id     uuid;
  v_owner_family  uuid;
  v_last_fed      timestamptz;
  v_times_fed     integer;
  v_balance       integer;
  v_cost          integer := 5;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select fm.family_id, fm.id into v_caller_family, v_member_id
  from family_members fm where fm.auth_user_id = auth.uid() limit 1;

  select fa.family_id, fa.last_fed_at into v_owner_family, v_last_fed
  from family_animals fa
  where fa.id = p_family_animal_id
  for update;

  if v_owner_family is null then
    raise exception 'animal not found';
  end if;
  if v_owner_family is distinct from v_caller_family then
    raise exception 'not your animal';
  end if;

  -- once per calendar day
  if v_last_fed is not null and v_last_fed::date = now()::date then
    raise exception 'already fed today';
  end if;

  select coalesce(sum(l.delta), 0) into v_balance
  from resource_ledger l
  where l.family_id = v_caller_family and l.kind = 'coins';

  if v_balance < v_cost then
    raise exception 'not enough coins: balance %, need %', v_balance, v_cost;
  end if;

  insert into resource_ledger (family_id, member_id, kind, delta, reason)
  values (v_caller_family, v_member_id, 'coins', -v_cost, 'animal_feed');

  update family_animals fa
  set times_fed = fa.times_fed + 1, last_fed_at = now()
  where fa.id = p_family_animal_id
  returning fa.times_fed into v_times_fed;

  select coalesce(sum(l.delta), 0) into v_balance
  from resource_ledger l
  where l.family_id = v_caller_family and l.kind = 'coins';

  return jsonb_build_object('times_fed', v_times_fed, 'coins_balance', v_balance);
end;
$$;

revoke all on function feed_animal(uuid) from public, anon;
grant execute on function feed_animal(uuid) to authenticated;