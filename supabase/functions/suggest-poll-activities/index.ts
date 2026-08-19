import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS } from '../_shared/types.ts';

const SYSTEM = `You suggest family outing or activity options for a poll the family will vote on.

Return ONLY JSON: { "question": string, "options": [{ "label": string, "detail": string }] }

Rules:
- Exactly 4 options.
- "question" is one short line the family votes on, e.g. "What should we do on Saturday?"
- "label" is 2-6 words, concrete and specific enough to picture.
- "detail" is one short sentence saying why it suits this family.
- Respect the budget ceiling given. At least one option must cost nothing.
- Respect the ages given: nothing a young child could not join in with.
- Vary the options: do not offer four versions of the same outing.
- Never mention parenting skills, training, assessment, or scoring.`;

type Suggestion = { question?: string; options?: { label?: string; detail?: string }[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const body = await req.json().catch(() => ({}));
    const occasion: string = typeof body?.occasion === 'string' ? body.occasion.slice(0, 120) : 'this weekend';

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'invalid session' }, 401);

    const { data: caller } = await userClient
      .from('family_members')
      .select('family_id, role')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (!caller) return json({ error: 'no family for this account' }, 403);
    if (!['parent', 'caregiver'].includes(String(caller.role))) {
      return json({ error: 'only a parent or caregiver can create a poll' }, 403);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [{ data: family }, { data: members }, { data: profile }] = await Promise.all([
      admin.from('families')
        .select('max_budget, geofence_radius_meters, has_pets')
        .eq('id', caller.family_id).maybeSingle(),
      admin.from('family_members')
        .select('id, display_name, role, birth_year')
        .eq('family_id', caller.family_id),
      admin.from('family_profiles')
        .select('summary, interest_weights')
        .eq('family_id', caller.family_id).maybeSingle(),
    ]);

    const thisYear = new Date().getFullYear();
    const ages = (members ?? [])
      .filter((m) => m.role === 'child' && m.birth_year)
      .map((m) => thisYear - (m.birth_year as number));

    //only family-facing half of profile is used 
    const prompt = JSON.stringify({
      occasion,
      max_budget: family?.max_budget ?? 0,
      travel_radius_meters: family?.geofence_radius_meters ?? 500,
      has_pets: family?.has_pets ?? false,
      child_ages: ages,
      adults: (members ?? []).filter((m) => m.role !== 'child').length,
      family_summary: profile?.summary ?? null,
      interest_weights: profile?.interest_weights ?? {},
    });

    let out: Suggestion;
    try {
      out = await generateJson<Suggestion>(SYSTEM, prompt, 0.9);
    } catch (e) {
      console.error('poll suggestion failed:', e);
      return json({ error: 'Suggestions are unavailable right now. Write your own options instead.' }, 503);
    }

    //normalise hard
    const options = (out.options ?? [])
      .map((o) => ({
        label: String(o?.label ?? '').trim().slice(0, 120),
        detail: String(o?.detail ?? '').trim().slice(0, 300) || null,
      }))
      .filter((o) => o.label.length > 0)
      .slice(0, 6);

    if (options.length < 2) {
      return json({ error: 'Could not come up with enough options. Write your own instead.' }, 502);
    }

    return json({
      question: String(out.question ?? `What should we do ${occasion}?`).trim().slice(0, 200),
      options,
      model: GEMINI_MODEL,
    });
  } catch (e) {
    console.error('suggest-poll-activities failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}