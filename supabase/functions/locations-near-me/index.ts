import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS_HEADERS } from '../_shared/types.ts';
import { findPlaces, categoriesWithPlaces } from '../_shared/places.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const { member_id, lat, lon } = await req.json();

    if (typeof lat !== 'number' || typeof lon !== 'number'
        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return json({ error: 'a valid lat and lon are required' }, 400);
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'invalid session' }, 401);

    const { data: caller } = await userClient
      .from('family_members')
      .select('family_id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (!caller) return json({ error: 'no family for this account' }, 403);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    //parents geofence filter
    const { data: family } = await admin
      .from('families')
      .select('geofence_radius_meters')
      .eq('id', caller.family_id)
      .maybeSingle();

    const radius = Math.min(Math.max(family?.geofence_radius_meters ?? 500, 100), 5000);

    //filter what member actually likes
    const placeable = categoriesWithPlaces();
    let categories: string[] = placeable;

    if (member_id) {
      const { data: member } = await admin
        .from('family_members')
        .select('id, family_id')
        .eq('id', member_id)
        .maybeSingle();

      if (!member || member.family_id !== caller.family_id) {
        return json({ error: 'that member is not in your family' }, 403);
      }

      const { data: interests } = await admin
        .from('member_interests')
        .select('category_key, weight')
        .eq('member_id', member_id)
        .gte('weight', 2)  //"like it" or "love it" only
        .order('weight', { ascending: false });

      const liked = (interests ?? [])
        .map((i) => i.category_key)
        .filter((k) => placeable.includes(k));

      //fall back to everything rather than returning nothing
      if (liked.length > 0) categories = liked;
    }

    let result;
    try {
      result = await findPlaces(lat, lon, radius, categories, 3);
    } catch (e) {
      console.error('place lookup failed:', e);
      return json({ error: 'Could not look up places right now. Please try again shortly.' }, 503);
    }

    console.log(`[locations] provider=${result.provider} radius=${radius} cats=${categories.length} found=${result.places.length}`);

    return json({
      places: result.places,
      radius_meters: radius,
      categories_used: categories,
      provider: result.provider,
    });
  } catch (e) {
    console.error('locations-near-me failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}