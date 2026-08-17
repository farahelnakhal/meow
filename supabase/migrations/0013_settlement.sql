--shared settlement

create table building_types (
  key         text primary key,
  label       text not null,
  description text not null,
  coin_cost   integer not null check (coin_cost > 0),
  -- gates later buildings behind earlier ones so the settlement grows in order
  unlock_after text references building_types(key),
  -- asset key the app maps to a local image; no remote URLs
  image_key   text not null,
  sort_order  integer not null,
  active      boolean not null default true
);

alter table building_types enable row level security;

create policy "signed in users can read building types"
  on building_types for select
  using (auth.uid() is not null and active);

--insert order matters; unlock_after self refers
insert into building_types (key, label, description, coin_cost, unlock_after, image_key, sort_order) values
  ('tent',       'Tent',           'Where it all starts. Somewhere to sleep.',        20,  null,        'tent',       1),
  ('firepit',    'Fire Pit',       'A place to gather after dark.',                   40,  'tent',      'firepit',    2),
  ('garden',     'Vegetable Plot', 'Grows food for the settlement.',                  60,  'firepit',   'garden',     3),
  ('well',       'Well',           'Fresh water, no more carrying buckets.',          80,  'garden',    'well',       4),
  ('workshop',   'Workshop',       'Where things get built and mended.',              120, 'well',      'workshop',   5),
  ('bakery',     'Bakery',         'The whole settlement smells like bread.',         160, 'workshop',  'bakery',     6),
  ('library',    'Library',        'Somewhere quiet to read.',                        200, 'bakery',    'library',    7),
  ('barn',       'Barn',           'Shelter for the animals you have hatched.',       260, 'library',   'barn',       8),
  ('watchtower', 'Watchtower',     'See the whole settlement from up here.',          320, 'barn',      'watchtower', 9),
  ('townhall',   'Town Hall',      'The heart of the settlement.',                    400, 'watchtower','townhall',  10);

--placed buildings (fixed 6x6 grid, one building per cell)
create table family_buildings (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  building_key text not null references building_types(key) on delete restrict,
  grid_x       smallint not null check (grid_x between 0 and 5),
  grid_y       smallint not null check (grid_y between 0 and 5),
  built_by     uuid references family_members(id) on delete set null,
  built_at     timestamptz not null default now(),

  --one building per cell per family
  unique (family_id, grid_x, grid_y),
  --and only one of each type per family, so the settlement diversifies
  unique (family_id, building_key)
);

create index idx_family_buildings_family on family_buildings(family_id);

alter table family_buildings enable row level security;

create policy "family can read own buildings"
  on family_buildings for select
  using (family_id = get_my_family_id());
-- writes via purchase_building only

--what this family can buy next, with affordability
create view available_buildings with (security_invoker = true) as
select
  bt.key,
  bt.label,
  bt.description,
  bt.coin_cost,
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

-- spends coins, places the building
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
    into v_label, v_cost, v_unlock_after
  from building_types bt
  where bt.key = p_building_key and bt.active;

  if v_label is null then
    raise exception 'unknown building %', p_building_key;
  end if;

  if p_grid_x is null or p_grid_y is null
     or p_grid_x < 0 or p_grid_x > 5 or p_grid_y < 0 or p_grid_y > 5 then
    raise exception 'grid position out of range';
  end if;

  --lock family row so two devices cannot both spend last coins on different stuff
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
    'coins_balance', v_balance
  );
end;
$$;

revoke all on function purchase_building(uuid, text, smallint, smallint) from public, anon;
grant execute on function purchase_building(uuid, text, smallint, smallint) to authenticated;