import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS } from '../_shared/types.ts';

const DAILY_LIMIT = 5;
const WANT = 4;

const SYSTEM = `You invent short family activities for a family activity app.

Return ONLY JSON:
{ "missions": [ {
    "title": string,
    "description": string,
    "est_cost": number,
    "min_age": number,
    "partners_required": 0 | 1 | 2,
    "location_type": "home" | "local",
    "verification_prompt": string
} ] }

Produce exactly 4 missions.

Rules for every mission:
- "title" is 2-5 words. "description" is one or two sentences, plain and warm.
- Refer to the other person as {X}. If two other people are needed use {X} and
  {Y} and set partners_required to 2. A solo activity uses 0 and no placeholder.
- "est_cost" is in the family's currency and must not exceed the budget given.
  At least two of the four must cost 0.
- "min_age" must be no higher than the youngest child's age given, for at least
  two of the four.
- "location_type" is "home" if it needs nothing outside the house. Use "local"
  only for a general place like a park; never name a specific venue, shop or
  landmark, because we cannot verify one exists.
- "verification_prompt" describes what a photo of the finished activity would
  plausibly show, in one sentence. Describe the general scene, not an exact
  count of objects.
- Nothing needing a car, money beyond the budget, sharp tools for young
  children, water deeper than a bath, or a stranger.
- Nothing that asks anyone to go anywhere alone or keep a secret from family.
- NEVER mention parenting skills, training, assessment, or scoring.
- These must be genuinely different from each other and specific enough to
  picture. No "spend time together" vagueness.`;

type Draft = {
  title?: string;
  description?: string;
  est_cost?: number;
  min_age?: number;
  partners_required?: number;
  location_type?: string;
  verification_prompt?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const body = await req.json().catch(() => ({}));
    const categoryKey: string | null =
      typeof body?.category_key === 'string' ? body.category_key : null;

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'invalid session' }, 401);

    const { data: caller } = await userClient
      .from('family_members')
      .select('id, family_id, role')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (!caller) return json({ error: 'no family for this account' }, 403);
    if (!['parent', 'caregiver'].includes(String(caller.role))) {
      return json({ error: 'only a parent or caregiver can add new missions' }, 403);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    //quota before model call
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const { count: runsToday } = await admin
      .from('mission_generation_log')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', caller.family_id)
      .gte('created_at', startOfDay.toISOString());

    if ((runsToday ?? 0) >= DAILY_LIMIT) {
      return json({
        error: 'Your family has generated all it can today. More tomorrow.',
        quota_remaining: 0,
      }, 429);
    }

    const [{ data: family }, { data: members }, { data: categories }, { data: existing }] =
      await Promise.all([
        admin.from('families')
          .select('max_budget, geofence_radius_meters, has_pets, games_owned')
          .eq('id', caller.family_id).maybeSingle(),
        admin.from('family_members')
          .select('id, display_name, role, birth_year')
          .eq('family_id', caller.family_id),
        admin.from('interest_categories').select('key, label'),
        // titles to avoid, so generation does not restate the catalog
        admin.from('missions').select('title')
          .or(`family_id.is.null,family_id.eq.${caller.family_id}`)
          .limit(200),
      ]);

    const validCategories = new Set((categories ?? []).map((c) => c.key));
    const category = categoryKey && validCategories.has(categoryKey) ? categoryKey : null;
    if (categoryKey && !category) {
      return json({ error: `unknown category ${categoryKey}` }, 400);
    }

    const thisYear = new Date().getFullYear();
    const childAges = (members ?? [])
      .filter((m) => m.role === 'child' && m.birth_year)
      .map((m) => thisYear - (m.birth_year as number));

    const memberCount = (members ?? []).length;
    const budget = Number(family?.max_budget ?? 0);
    const youngest = childAges.length ? Math.min(...childAges) : 5;

    const promptContext = {
      category: category
        ? (categories ?? []).find((c) => c.key === category)?.label ?? category
        : 'any',
      max_budget: budget,
      youngest_child_age: youngest,
      child_ages: childAges,
      family_size: memberCount,
      has_pets: family?.has_pets ?? false,
      games_owned: family?.games_owned ?? [],
      avoid_titles: (existing ?? []).map((m) => m.title).slice(0, 120),
    };

    let drafts: Draft[];
    try {
      const out = await generateJson<{ missions?: Draft[] }>(
        SYSTEM,
        JSON.stringify(promptContext),
        1.0
      );
      drafts = out.missions ?? [];
    } catch (e) {
      console.error('mission generation failed:', e);
      return json({ error: 'Could not think of new missions right now. Try again shortly.' }, 503);
    }

    //validation, assumes every generated row is untrusted
    const rejectReasons: string[] = [];
    const rows: Record<string, unknown>[] = [];
    const seen = new Set((existing ?? []).map((m) => String(m.title).toLowerCase()));

    for (const d of drafts.slice(0, 8)) {
      const title = String(d?.title ?? '').trim().slice(0, 80);
      const description = String(d?.description ?? '').trim().slice(0, 400);
      const vprompt = String(d?.verification_prompt ?? '').trim().slice(0, 300);
      const partners = Number(d?.partners_required ?? 1);
      const cost = Number(d?.est_cost ?? 0);
      const minAge = Number(d?.min_age ?? 0);
      const loc = d?.location_type === 'local' ? 'local' : 'home';

      if (title.length < 3) { rejectReasons.push('title too short'); continue; }
      if (description.length < 10) { rejectReasons.push(`${title}: description too short`); continue; }
      if (vprompt.length < 10) { rejectReasons.push(`${title}: verification prompt too short`); continue; }
      if (seen.has(title.toLowerCase())) { rejectReasons.push(`${title}: duplicate title`); continue; }
      if (!Number.isFinite(cost) || cost < 0 || cost > budget) {
        rejectReasons.push(`${title}: cost ${cost} over budget ${budget}`); continue;
      }
      if (![0, 1, 2].includes(partners)) { rejectReasons.push(`${title}: bad partners_required`); continue; }
      if (partners > memberCount - 1) {
        rejectReasons.push(`${title}: needs ${partners} partners, family has ${memberCount}`); continue;
      }
      if (!Number.isFinite(minAge) || minAge < 0 || minAge > 120) {
        rejectReasons.push(`${title}: bad min_age`); continue;
      }
      //placeholders must match declared partner count, or app renders a raw {X} or drops a person from mission
      const hasX = description.includes('{X}');
      const hasY = description.includes('{Y}');
      if (partners >= 1 && !hasX) { rejectReasons.push(`${title}: missing {X}`); continue; }
      if (partners === 2 && !hasY) { rejectReasons.push(`${title}: missing {Y}`); continue; }
      if (partners < 2 && hasY) { rejectReasons.push(`${title}: has {Y} but partners_required < 2`); continue; }
      if (partners === 0 && hasX) { rejectReasons.push(`${title}: solo mission has {X}`); continue; }
      //no leftover square-bracket placeholders thew model invented
      if (/\[.+\]/.test(description)) { rejectReasons.push(`${title}: unresolved [placeholder]`); continue; }

      seen.add(title.toLowerCase());

      rows.push({
        title,
        description,
        category_key: category ?? 'talking',
        est_cost: cost,
        cost_tier: cost === 0 ? 0 : cost < 10 ? 1 : cost <= 20 ? 2 : 3,
        min_age: minAge,
        max_age: 120,
        partners_required: partners,
        requires_game: null,
        requires_pet: false,
        needs_location: false,
        location_type: loc,
        points: 15,
        coins: 8,
        verification_prompt: vprompt,
        active: true,
        source: 'generated',
        family_id: caller.family_id,
      });

      if (rows.length >= WANT) break;
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data: ins, error: insErr } = await admin
        .from('missions')
        .insert(rows)
        .select('id, title');
      if (insErr) throw new Error(`mission insert failed: ${insErr.message}`);
      inserted = ins?.length ?? 0;
    }

    await admin.from('mission_generation_log').insert({
      family_id: caller.family_id,
      requested_by: caller.id,
      category_key: category,
      prompt_context: promptContext,
      raw_response: { missions: drafts },
      accepted: inserted,
      rejected: rejectReasons.length,
      reject_reasons: rejectReasons.slice(0, 20),
      model: GEMINI_MODEL,
    });

    console.log(`[generate] family=${caller.family_id} accepted=${inserted} rejected=${rejectReasons.length}`);

    if (inserted === 0) {
      return json({
        error: 'None of the new ideas passed our checks. Try again.',
        rejected: rejectReasons.slice(0, 5),
      }, 502);
    }

    return json({
      created: inserted,
      titles: rows.map((r) => r.title),
      rejected: rejectReasons.length,
      quota_remaining: Math.max(0, DAILY_LIMIT - ((runsToday ?? 0) + 1)),
    });
  } catch (e) {
    console.error('generate-missions failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}