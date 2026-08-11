--mission catalog (client-supplied, templated).

-- CLIENT READABLE
-- pet ownership gates 3 missions; collected at signup alongside the other limits
alter table families add column if not exists has_pets boolean not null default false;

create table missions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text not null,
  category_key text not null references interest_categories(key),

  est_cost  numeric(10, 2) not null default 0,
  cost_tier smallint not null default 0 check (cost_tier between 0 and 3),

  min_age integer not null default 0,
  max_age integer not null default 120,

  --how many other family members this mission needs: 0 solo, 1 = {X}, 2 = {X} and {Y}
  partners_required smallint not null default 1
                    check (partners_required between 0 and 2),

  requires_game text,
  requires_pet  boolean not null default false,

  --true = needs a real named venue (pending locations-near-me function)
  needs_location boolean not null default false,

  location_type text not null default 'home'
                check (location_type in ('home', 'local', 'anywhere')),

  points integer not null default 10 check (points >= 0),
  coins  integer not null default 5  check (coins  >= 0),

  verification_prompt text not null,

  active     boolean not null default true,
  created_at timestamptz not null default now(),

  constraint missions_age_range_valid check (min_age <= max_age),
  -- a {Y} placeholder is meaningless unless two partners are required
  constraint missions_y_needs_two_partners
    check (partners_required = 2 or position('{Y}' in description) = 0)
);

create index idx_missions_category on missions(category_key) where active;
create index idx_missions_cost on missions(est_cost) where active;

alter table missions enable row level security;

create policy "signed in users can read active missions"
  on missions for select
  using (auth.uid() is not null and active);

-- PRIVATE

-- which catalog missions secretly target a caregiver skill.
create table mission_skill_map (
  mission_id   uuid primary key references missions(id) on delete cascade,
  skill_target text not null check (skill_target in (
    'active_listening',
    'emotional_support',
    'constructive_discipline',
    'safe_tech_use'
  )),
  sequence_hint smallint not null default 1
);

alter table mission_skill_map enable row level security;
revoke all on mission_skill_map from anon, authenticated;

insert into missions
  (title, description, category_key, est_cost, cost_tier, min_age, max_age,
   partners_required, requires_game, requires_pet, needs_location,
   location_type, points, coins, verification_prompt)
values
('Paint a family portrait', 'Paint a portrait of {X} while they paint one of you. Swap and compare at the end.', 'arts', 3.00, 1, 5, 120, 1, null, false, false, 'home', 15, 8, 'Two hand-painted or hand-drawn portraits of people, shown together.'),
('Make friendship bracelets', 'Make a friendship bracelet each for {X} and {Y}.', 'arts', 5.00, 1, 6, 120, 2, null, false, false, 'home', 15, 8, 'Two or more handmade woven or beaded bracelets.'),
('Cardboard photo frame', 'Build a photo frame out of cardboard with {X} and decorate it.', 'arts', 3.00, 1, 5, 120, 1, null, false, false, 'home', 15, 8, 'A handmade cardboard picture frame, visibly decorated.'),
('Family photo collage', 'Make a collage from ten family photos with {X}.', 'arts', 2.00, 1, 5, 120, 1, null, false, false, 'home', 15, 8, 'Multiple photographs arranged and stuck together as a collage.'),
('Ten creative photos', 'Take ten creative photographs of {X} around the house or outdoors, then pick your favourite together.', 'arts', 0.00, 0, 7, 120, 1, null, false, false, 'anywhere', 10, 5, 'A deliberately composed photograph of a person.'),
('Homemade pizza', 'Make a pizza with {X} — each of you tops one half your own way.', 'cooking', 12.00, 2, 5, 120, 1, null, false, false, 'home', 20, 10, 'A homemade pizza, cooked, with visible toppings.'),
('Chocolate-chip cookies', 'Bake chocolate-chip cookies with {X}.', 'cooking', 10.00, 2, 5, 120, 1, null, false, false, 'home', 20, 10, 'Baked cookies with visible chocolate chips.'),
('Pancakes, their toppings', 'Make pancakes for {X} and let them choose every topping.', 'cooking', 8.00, 1, 5, 120, 1, null, false, false, 'home', 15, 8, 'Cooked pancakes on a plate with toppings.'),
('Three-fruit smoothie', 'Make a smoothie with {X} using three fruits you have never combined before.', 'cooking', 8.00, 1, 4, 120, 1, null, false, false, 'home', 15, 8, 'A blended fruit drink in a glass or blender jug.'),
('Cook their favourite meal', 'Cook {X}''s favourite meal together.', 'cooking', 15.00, 2, 7, 120, 1, null, false, false, 'home', 20, 10, 'A cooked meal plated or served.'),
('Three new places', 'Take a thirty-minute walk with {X} and find three places neither of you has been before.', 'outdoors', 0.00, 0, 6, 120, 1, null, false, false, 'local', 20, 10, 'An outdoor location away from home.'),
('Picnic in the park', 'Have a picnic with {X} in a local park.', 'outdoors', 10.00, 2, 3, 120, 1, null, false, false, 'local', 20, 10, 'Food laid out outdoors on grass or a blanket.'),
('Nature scavenger hunt', 'Go on a scavenger hunt with {X}. Find something smooth, something yellow, something older than you, something smaller than your thumb, and something that makes a sound.', 'outdoors', 0.00, 0, 4, 120, 1, null, false, false, 'local', 20, 10, 'Collected natural objects gathered together outdoors.'),
('Visit a local landmark', 'Visit a landmark near you with {X}.', 'outdoors', 0.00, 0, 5, 120, 1, null, false, true, 'local', 20, 10, 'A recognisable public landmark or notable place.'),
('Sunset walk', 'Go on a sunset walk with {X} and watch it go down together.', 'outdoors', 0.00, 0, 5, 120, 1, null, false, false, 'local', 15, 8, 'An outdoor sky at sunset or dusk.'),
('Truth or Dare', 'Play Truth or Dare with {X} and {Y}.', 'games', 0.00, 0, 7, 120, 2, null, false, false, 'home', 10, 5, 'Two or more people together, clearly interacting.'),
('Hundred-piece puzzle', 'Complete a hundred-piece puzzle with {X}.', 'games', 8.00, 1, 5, 120, 1, null, false, false, 'home', 20, 10, 'A jigsaw puzzle partly or fully assembled.'),
('Teach them your game', 'Teach {X} your favourite board or card game, then play a full round.', 'games', 0.00, 0, 6, 120, 1, null, false, false, 'home', 15, 8, 'A board or card game set up or in progress.'),
('Three-round trivia', 'Run a three-round trivia challenge against {X}.', 'games', 0.00, 0, 7, 120, 1, null, false, false, 'home', 10, 5, 'Written quiz questions, or two people playing a quiz together.'),
('Quiz about each other', 'Write a five-question quiz about yourself for {X} while they write one about themselves for you.', 'games', 0.00, 0, 7, 120, 1, null, false, false, 'home', 15, 8, 'Handwritten or typed quiz questions.'),
('Twenty minutes of football', 'Play twenty minutes of football with {X}.', 'sports', 0.00, 0, 5, 120, 1, null, false, false, 'local', 15, 8, 'A football and an outdoor or open play space.'),
('Best of five baskets', 'Challenge {X} to a best-of-five basketball shooting contest.', 'sports', 0.00, 0, 6, 120, 1, null, false, false, 'local', 15, 8, 'A basketball and a hoop.'),
('Thirty-minute bike ride', 'Go on a thirty-minute bike ride with {X}.', 'sports', 0.00, 0, 6, 120, 1, null, false, false, 'local', 20, 10, 'A bicycle outdoors.'),
('Learn a dance routine', 'Learn and practise a simple dance routine with {X}.', 'sports', 0.00, 0, 4, 120, 1, null, false, false, 'home', 15, 8, 'People mid-movement or dancing.'),
('Teach them your stretch', 'Teach {X} your favourite exercise or stretch and do it together for ten minutes.', 'sports', 0.00, 0, 5, 120, 1, null, false, false, 'home', 10, 5, 'A person exercising or stretching.'),
('Sing their favourite song', 'Sing {X}''s favourite song together, start to finish.', 'music', 0.00, 0, 3, 120, 1, null, false, false, 'home', 10, 5, 'Two or more people singing, or a song playing on a device.'),
('Teach them a song', 'Teach {X} how to play a simple song on any instrument you have at home.', 'music', 0.00, 0, 6, 120, 1, null, false, false, 'home', 20, 10, 'A musical instrument being played or held.'),
('Karaoke for two', 'Have a two-person karaoke session with {X}.', 'music', 0.00, 0, 5, 120, 1, null, false, false, 'home', 15, 8, 'People singing with lyrics or a karaoke screen visible.'),
('Five-song playlist', 'Build a five-song playlist with {X} and listen to all of it together.', 'music', 0.00, 0, 6, 120, 1, null, false, false, 'home', 10, 5, 'A playlist screen showing several songs.'),
('Perform for the family', 'Perform a one-minute song, dance or comedy routine for the rest of the family with {X}.', 'music', 0.00, 0, 5, 120, 1, null, false, false, 'home', 20, 10, 'People performing in front of an audience at home.'),
('Tallest LEGO tower', 'Build the tallest LEGO tower you can with {X}.', 'building', 0.00, 0, 4, 120, 1, 'LEGO', false, false, 'home', 15, 8, 'A tall tower built from interlocking plastic bricks.'),
('Paper airplane contest', 'Build paper airplanes with {X} and hold a flying competition.', 'building', 0.00, 0, 5, 120, 1, null, false, false, 'home', 10, 5, 'Two or more folded paper airplanes.'),
('Blanket fort', 'Build a blanket fort with {X} and spend fifteen minutes inside it.', 'building', 0.00, 0, 3, 120, 1, null, false, false, 'home', 20, 10, 'A fort or den built from blankets, cushions or boxes.'),
('Bird feeder', 'Make a birdhouse or bird feeder with {X}.', 'building', 12.00, 2, 6, 120, 1, null, false, false, 'home', 20, 10, 'A handmade bird feeder or birdhouse.'),
('Bridge for LEGO people', 'Build a bridge from household materials with {X} strong enough to hold LEGO figures.', 'building', 0.00, 0, 7, 120, 1, 'LEGO', false, false, 'home', 20, 10, 'An improvised bridge structure with small figures on it.'),
('Walk the pet together', 'Take {X}''s pet for a walk together.', 'animals', 0.00, 0, 5, 120, 1, null, true, false, 'local', 15, 8, 'A pet animal outdoors on a walk.'),
('Teach a pet a trick', 'Teach a pet one simple new trick with {X}.', 'animals', 0.00, 0, 4, 120, 1, null, true, false, 'home', 15, 8, 'A person interacting with a domestic animal.'),
('Visit the animals', 'Visit a local animal shelter, farm, aquarium or zoo with {X}.', 'animals', 0.00, 0, 4, 120, 1, null, false, true, 'local', 20, 10, 'Animals at a shelter, farm, aquarium or zoo.'),
('Sit with the pet', 'Spend ten quiet minutes petting and sitting with your pet alongside {X}.', 'animals', 0.00, 0, 3, 120, 1, null, true, false, 'home', 10, 5, 'A person petting a domestic animal.'),
('Same book, best bit', 'Read the same short book as {X}, then tell each other your favourite part.', 'books', 0.00, 0, 6, 120, 1, null, false, false, 'home', 15, 8, 'An open book, or two people reading together.'),
('They pick the book', 'Let {X} choose a book for the two of you to read together.', 'books', 0.00, 0, 4, 120, 1, null, false, false, 'home', 10, 5, 'A book being read or held open.'),
('Act out a scene', 'Act out a scene from a favourite book with {X}.', 'books', 0.00, 0, 5, 120, 1, null, false, false, 'home', 15, 8, 'People acting or posing dramatically, possibly with a book nearby.'),
('Write a new ending', 'Write a new ending to {X}''s favourite story together.', 'books', 0.00, 0, 7, 120, 1, null, false, false, 'home', 15, 8, 'Handwritten or typed story text.'),
('Books for each other', 'Visit a bookshop or library with {X} and pick a book for each other.', 'books', 0.00, 0, 4, 120, 1, null, false, true, 'local', 20, 10, 'A library or bookshop interior with shelves of books.'),
('Baking soda volcano', 'Make a baking soda and vinegar volcano with {X}.', 'science', 4.00, 1, 5, 120, 1, null, false, false, 'home', 15, 8, 'A visible fizzing or foaming eruption.'),
('Straw rocket', 'Build a paper or straw rocket with {X} and see how far it flies.', 'science', 2.00, 1, 6, 120, 1, null, false, false, 'home', 15, 8, 'A small handmade paper or straw rocket.'),
('Magnifying glass hunt', 'Use a magnifying glass with {X} to investigate five things outside.', 'science', 5.00, 1, 5, 120, 1, null, false, false, 'local', 15, 8, 'A magnifying glass held over an object or surface.'),
('Find the Moon', 'Find the Moon together with {X}.', 'science', 0.00, 0, 4, 120, 1, null, false, false, 'local', 10, 5, 'The Moon visible in the sky.'),
('How does it work', 'Pick one everyday object with {X} and find out together how it actually works.', 'science', 0.00, 0, 8, 120, 1, null, false, false, 'home', 15, 8, 'An everyday household object being examined, or notes about it.'),
('Phone-free twenty minutes', 'Have a twenty-minute phone-free conversation with {X} over a snack or a drink.', 'talking', 0.00, 0, 6, 120, 1, null, false, false, 'home', 15, 8, 'Two or more people sitting together with food or drink, no phones in use.'),
('Five questions about childhood', 'Ask {X} five questions about their childhood and listen to every answer in full.', 'talking', 0.00, 0, 6, 120, 1, null, false, false, 'home', 15, 8, 'Two people in conversation, or written notes from an interview.'),
('Their happiest memory', 'Ask {X} to tell you about their happiest memory.', 'talking', 0.00, 0, 5, 120, 1, null, false, false, 'home', 10, 5, 'Two or more people sitting together talking.'),
('Would You Rather', 'Play Would You Rather with {X} for ten minutes.', 'talking', 0.00, 0, 5, 120, 1, null, false, false, 'home', 10, 5, 'Two or more people together, clearly interacting.'),
('Five favourite photos', 'Look through old family photos with {X} and choose your five favourites.', 'talking', 0.00, 0, 5, 120, 1, null, false, false, 'home', 15, 8, 'Printed photographs or a photo gallery being looked through together.'),
('Plant and tend it', 'Plant a flower or a herb with {X} and agree who waters it for the next month.', 'nature', 8.00, 1, 4, 120, 1, null, false, false, 'home', 20, 10, 'A plant pot with soil and something planted in it.'),
('Identify three birds', 'Go birdwatching with {X} and identify three different birds.', 'nature', 0.00, 0, 5, 120, 1, null, false, false, 'local', 15, 8, 'A bird outdoors.'),
('Leaf collage', 'Collect fallen leaves with {X} and make a leaf collage.', 'nature', 0.00, 0, 3, 120, 1, null, false, false, 'local', 15, 8, 'Multiple leaves arranged or stuck onto a surface.'),
('Thirty minutes of litter', 'Spend thirty minutes picking up litter in your neighbourhood with {X}.', 'nature', 0.00, 0, 6, 120, 1, null, false, false, 'local', 20, 10, 'A bag of collected litter, or someone picking litter outdoors.'),
('One sunset photo', 'Watch the sunset with {X} and take one photo that captures it.', 'nature', 0.00, 0, 4, 120, 1, null, false, false, 'local', 10, 5, 'A sunset sky photograph.'),
('Teach them the app', 'Teach {X} how to use an app or a phone feature they did not know about.', 'technology', 0.00, 0, 7, 120, 1, null, false, false, 'home', 15, 8, 'Two people looking at a phone or computer screen together.'),
('Short family video', 'Make a short family video with {X}.', 'technology', 0.00, 0, 7, 120, 1, null, false, false, 'home', 20, 10, 'A video editing screen or a phone recording video.'),
('Memory slideshow', 'Make a digital slideshow of your favourite family memories with {X}.', 'technology', 0.00, 0, 7, 120, 1, null, false, false, 'home', 15, 8, 'A slideshow or photo gallery on a screen.'),
('Silly AI story', 'Use an AI tool with {X} to make a funny story or picture about your family.', 'technology', 0.00, 0, 8, 120, 1, null, false, false, 'home', 15, 8, 'A screen showing AI-generated text or an image.'),
('Take apart a gadget', 'Take apart an old, safe household gadget with {X} and work out what each part does.', 'technology', 0.00, 0, 9, 120, 1, null, false, false, 'home', 20, 10, 'A disassembled electronic device with parts visible.'),
('Hairstyle makeover', 'Give {X} a completely new hairstyle.', 'fashion', 0.00, 0, 5, 120, 1, null, false, false, 'home', 15, 8, 'A person with a styled or restyled hairstyle.'),
('Outfit from their wardrobe', 'Choose a complete outfit for {X} using only clothes they already own.', 'fashion', 0.00, 0, 6, 120, 1, null, false, false, 'home', 15, 8, 'A person wearing a deliberately chosen outfit, or an outfit laid out.'),
('Style swap', 'Have a style swap with {X} — each of you picks the other''s outfit.', 'fashion', 0.00, 0, 6, 120, 1, null, false, false, 'home', 15, 8, 'A person wearing a chosen outfit.'),
('Recreate an old photo', 'Recreate an outfit from an old family photograph with {X}.', 'fashion', 0.00, 0, 6, 120, 1, null, false, false, 'home', 20, 10, 'A person dressed to match an older photograph.'),
('Matching accessories', 'Make matching accessories with {X} — bracelets, pins or decorated hats.', 'fashion', 8.00, 1, 5, 120, 1, null, false, false, 'home', 15, 8, 'Two or more handmade matching accessories.'),
('Recreate a tradition', 'Ask {X} to teach you one family tradition, then do it together.', 'community', 0.00, 0, 6, 120, 1, null, false, false, 'home', 20, 10, 'People taking part in a shared activity or ritual at home.'),
('Cook a cultural dish', 'Cook a traditional family or cultural dish with {X} and learn where it comes from.', 'community', 15.00, 2, 7, 120, 1, null, false, false, 'home', 20, 10, 'A prepared traditional dish.'),
('Family timeline', 'Look through family photos with {X} and build a simple family timeline.', 'community', 0.00, 0, 7, 120, 1, null, false, false, 'home', 15, 8, 'A handwritten or printed timeline, or photos laid out in order.'),
('Visit a cultural site', 'Visit a local cultural site, museum or community event with {X}.', 'community', 0.00, 0, 5, 120, 1, null, false, true, 'local', 20, 10, 'A museum, cultural site or public community event.'),
('Help a neighbour', 'Do one helpful task for a neighbour or community member with {X}.', 'community', 0.00, 0, 7, 120, 1, null, false, false, 'local', 20, 10, 'Someone helping another person outdoors or at a doorway.');

--every title below already reads as an ordinary mission; only this table knows what it targets
insert into mission_skill_map (mission_id, skill_target, sequence_hint)
select id, 'active_listening', 1 from missions where title = 'Phone-free twenty minutes'
union all select id, 'active_listening', 2 from missions where title = 'Five questions about childhood'
union all select id, 'active_listening', 3 from missions where title = 'Their happiest memory'
union all select id, 'active_listening', 4 from missions where title = 'Same book, best bit'
union all select id, 'emotional_support', 1 from missions where title = 'Five favourite photos'
union all select id, 'emotional_support', 2 from missions where title = 'Write a new ending'
union all select id, 'emotional_support', 3 from missions where title = 'Recreate a tradition'
union all select id, 'constructive_discipline', 1 from missions where title = 'Teach them your game'
union all select id, 'constructive_discipline', 2 from missions where title = 'Hundred-piece puzzle'
union all select id, 'constructive_discipline', 3 from missions where title = 'Bridge for LEGO people'
union all select id, 'safe_tech_use', 1 from missions where title = 'Teach them the app'
union all select id, 'safe_tech_use', 2 from missions where title = 'Silly AI story'
union all select id, 'safe_tech_use', 3 from missions where title = 'Take apart a gadget';

--extend family creation to capture pet ownership (gates 3 missions).
drop function if exists create_family_with_parent(text, text, numeric, integer, text[]);

create or replace function create_family_with_parent(
  p_family_name            text,
  p_parent_name            text,
  p_max_budget             numeric  default 0,
  p_geofence_radius_meters integer  default 500,
  p_games_owned            text[]   default '{}',
  p_has_pets               boolean  default false
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

  if exists (select 1 from family_members where auth_user_id = auth.uid()) then
    raise exception 'user already belongs to a family';
  end if;

  insert into families (name, max_budget, geofence_radius_meters, games_owned, has_pets)
  values (p_family_name, p_max_budget, p_geofence_radius_meters, p_games_owned, p_has_pets)
  returning id into v_family_id;

  insert into family_members (family_id, auth_user_id, display_name, role)
  values (v_family_id, auth.uid(), p_parent_name, 'parent');

  return v_family_id;
end;
$$;

revoke all on function create_family_with_parent(text, text, numeric, integer, text[], boolean) from public, anon;
grant execute on function create_family_with_parent(text, text, numeric, integer, text[], boolean) to authenticated;