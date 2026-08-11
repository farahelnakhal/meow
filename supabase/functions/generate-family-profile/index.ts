import { createClient } from '@supabase/supabase-js';
import { generateJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import {
  CORS_HEADERS, scoreDomains, skillFocusFrom,
  type GeneratedProfile, type SurveyRow,
} from '../_shared/types.ts';

const SYSTEM = `You build a structured family profile for a family activity app.

Return ONLY valid JSON:
{
  "summary": string,
  "interest_weights": { "<category_key>": number between 0 and 1 },
  "dynamics": { "notes": string, "under_connected_pairs": [[memberId, memberId]] }
}

Rules:
- interest_weights must include EVERY category key you were given, aggregated
  across the whole family.
- under_connected_pairs are member id pairs whose shared interests barely
  overlap, so missions should be biased toward pairing them.
- summary is 2-3 warm, plain sentences a parent would be happy to read.
- Never mention parenting skills, training, assessment or scoring. Do not
  reference the scenario survey at all.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const { family_id } = await req.json();
    if (!family_id) return json({ error: 'family_id is required' }, 400);

    // 1. Verify membership under the caller's own JWT
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

    if (!caller || caller.family_id !== family_id) {
      return json({ error: 'not a member of this family' }, 403);
    }

    // 2. Read inputs with service role
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: members } = await admin
      .from('family_members')
      .select('id, display_name, role, birth_year')
      .eq('family_id', family_id);

    const memberIds = (members ?? []).map((m) => m.id);
    if (!memberIds.length) return json({ error: 'family has no members' }, 400);

    const [{ data: interests }, { data: survey }, { data: categories }] = await Promise.all([
      admin.from('member_interests').select('member_id, category_key, weight').in('member_id', memberIds),
      admin.from('parent_survey_responses').select('question_key, answer_text, answer_value').in('member_id', memberIds),
      admin.from('interest_categories').select('key, label').order('sort_order'),
    ]);

    const surveyRows = (survey ?? []) as SurveyRow[];
    if (!surveyRows.length) return json({ error: 'no caregiver survey responses yet' }, 400);

    // 3. skill_focus is computed DETERMINISTICALLY from the scoring key, not
    //    by the model. It is the one output that must be reproducible and
    //    auditable, and the model has no business guessing at it.
    const domainScores = scoreDomains(surveyRows);
    const skillFocus = skillFocusFrom(surveyRows, 2);

    // 4. The model only writes the family-facing half.
    const prompt = JSON.stringify({
      category_keys: (categories ?? []).map((c) => c.key),
      members: (members ?? []).map((m) => ({
        id: m.id,
        name: m.display_name,
        role: m.role,
        age: m.birth_year ? new Date().getFullYear() - m.birth_year : null,
      })),
      interests,
    });

    let profile: GeneratedProfile | null = null;
    try {
      profile = await generateJson<GeneratedProfile>(SYSTEM, prompt);
    } catch (e) {
      console.error('gemini profile generation failed:', e);
    }

    // Fallback keeps setup unblocked and keeps skill_focus correct even when
    // the model is unavailable -- weights come straight from the raw interests.
    if (!profile) {
      profile = {
        summary: 'Your family profile is ready. Missions will be picked from what each person said they enjoy.',
        interest_weights: fallbackWeights(interests ?? [], (categories ?? []).map((c) => c.key)),
        dynamics: { notes: 'generated without model assistance', under_connected_pairs: [] },
      };
    }

    const { error: pubErr } = await admin.from('family_profiles').upsert({
      family_id,
      summary: profile.summary,
      interest_weights: profile.interest_weights ?? {},
      dynamics: profile.dynamics ?? {},
      model: GEMINI_MODEL,
      generated_at: new Date().toISOString(),
    });
    if (pubErr) throw new Error(`family_profiles write failed: ${pubErr.message}`);

    const { error: privErr } = await admin.from('family_profile_private').upsert({
      family_id,
      skill_focus: skillFocus,
      rationale: `domain means -> ${JSON.stringify(domainScores)}; lowest two selected`,
      generated_at: new Date().toISOString(),
    });
    if (privErr) throw new Error(`family_profile_private write failed: ${privErr.message}`);

    // Never echo skill_focus or domain scores back to the client.
    return json({ ok: true, summary: profile.summary });
  } catch (e) {
    console.error('generate-family-profile failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function fallbackWeights(
  interests: { category_key: string; weight: number }[],
  keys: string[]
): Record<string, number> {
  const sum: Record<string, number[]> = {};
  for (const k of keys) sum[k] = [];
  for (const i of interests) if (sum[i.category_key]) sum[i.category_key].push(i.weight);
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = sum[k].length ? sum[k].reduce((a, b) => a + b, 0) / (sum[k].length * 3) : 0.33;
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}