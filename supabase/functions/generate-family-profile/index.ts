import { createClient } from '@supabase/supabase-js';
import { generateJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS, type GeneratedProfile } from '../_shared/types.ts';

const SYSTEM = `You build structured family profiles for a family activity app.
Return ONLY valid JSON matching this shape:
{
  "summary": string,
  "interest_weights": { "<category_key>": number between 0 and 1 },
  "dynamics": { "notes": string, "under_connected_pairs": [[memberId, memberId]] },
  "skill_focus": [1 to 2 of: "active_listening", "constructive_discipline", "emotional_regulation", "tech_balance"],
  "skill_rationale": string
}
Rules:
- interest_weights must cover every category key you were given, aggregated across the family.
- skill_focus is chosen from the parent's survey scores: LOWER effective scores mean MORE need.
- summary is 2-3 sentences, warm and plain, safe for a parent to read.
- skill_rationale is for internal use and is never shown to a user.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'missing authorization header' }, 401);
    }

    const { family_id } = await req.json();
    if (!family_id) return json({ error: 'family_id is required' }, 400);

    //verify caller actually belongs to this family (runs under their JWT + RLS)
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

    if (!caller || caller.family_id !== family_id) {
      return json({ error: 'not a member of this family' }, 403);
    }

    //read inputs with service role (needs to see everything unfiltered)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: members } = await admin
      .from('family_members')
      .select('id, display_name, role, birth_year')
      .eq('family_id', family_id);

    const memberIds = (members ?? []).map((m) => m.id);

    const [{ data: interests }, { data: survey }, { data: categories }] = await Promise.all([
      admin.from('member_interests').select('member_id, category_key, weight').in('member_id', memberIds),
      admin.from('parent_survey_responses').select('member_id, question_key, answer_value').in('member_id', memberIds),
      admin.from('interest_categories').select('key, label').order('sort_order'),
    ]);

    if (!survey?.length) return json({ error: 'no survey responses yet' }, 400);

    //generate
    const prompt = JSON.stringify({
      category_keys: (categories ?? []).map((c) => c.key),
      members: (members ?? []).map((m) => ({
        id: m.id,
        name: m.display_name,
        role: m.role,
        age: m.birth_year ? new Date().getFullYear() - m.birth_year : null,
      })),
      interests,
      parent_survey: survey,
      survey_scale: '1 = never, 5 = always. Question keys prefixed al_/cd_/er_/tb_ map to active_listening/constructive_discipline/emotional_regulation/tech_balance. Keys al_2, cd_2, er_2, tb_2 are reverse-scored (high = more need).',
    });

    const profile = await generateJson<GeneratedProfile>(SYSTEM, prompt);

    //split the write into client readable and unreadable
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
      skill_focus: profile.skill_focus ?? [],
      rationale: profile.skill_rationale ?? null,
      generated_at: new Date().toISOString(),
    });
    if (privErr) throw new Error(`family_profile_private write failed: ${privErr.message}`);

    //never echo the private half back to client
    return json({ ok: true, summary: profile.summary });
  } catch (e) {
    console.error('generate-family-profile failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}