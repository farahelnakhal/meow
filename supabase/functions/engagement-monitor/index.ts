import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS } from '../_shared/types.ts';
import { moderateParentNote } from '../_shared/moderation.ts';

const SYSTEM = `You write short private notes for a parent about how their family is
getting on with a family activity app.

Return ONLY JSON: { "notes": [ { "id": string, "message": string } ] }

You will be given flags that were detected by arithmetic, with the numbers
behind each one. Your only job is to phrase each one for the parent. Do not
invent flags, do not change the numbers, and do not add flags you were not
given.

For every message:
- Two sentences at most. Warm, plain, never clinical.
- Say what was noticed, then one concrete thing they could try.
- Never diagnose, never speculate about feelings, never suggest anything is
  wrong with a child. "Sam hasn't finished a mission in two weeks" is fine.
  "Sam may be withdrawing" is not.
- Never use the words disengaged, concerning, problem, failure, behind, or
  refusing.
- Do not mention parenting skills, training, assessment, or scoring.
- Use the member names given. If a flag has no member, it is about the whole
  family.
- Suggestions should be small and doable this week, not lifestyle advice.`;

type Note = { id?: string; message?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const { family_id } = await req.json();
    if (!family_id) return json({ error: 'family_id is required' }, 400);

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

    if (!caller || caller.family_id !== family_id) {
      return json({ error: 'not a member of this family' }, 403);
    }
    if (!['parent', 'caregiver'].includes(String(caller.role))) {
      return json({ error: 'only a parent or caregiver can see this' }, 403);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    //detection runs under callers JWT because it is security definer and rederives family itself. arithmetic decideds what is flagged
    const { error: detectErr } = await userClient.rpc('detect_engagement_flags', {
      p_family_id: family_id,
    });
    if (detectErr) throw new Error(`detection failed: ${detectErr.message}`);

    const { data: flags } = await admin
      .from('engagement_flags')
      .select('id, member_id, member_b_id, kind, severity, evidence, message')
      .eq('family_id', family_id)
      .eq('status', 'open')
      .order('severity', { ascending: false })
      .order('detected_at', { ascending: false })
      .limit(10);

    if (!flags || flags.length === 0) {
      return json({ flags: [], phrased: 0, message: 'Nothing to flag right now.' });
    }

    //only phrase unphrased, so reopening dashboard is free
    const unphrased = flags.filter((f) => !f.message);

    if (unphrased.length === 0) {
      return json({ flags, phrased: 0 });
    }

    const { data: members } = await admin
      .from('family_members')
      .select('id, display_name, role')
      .eq('family_id', family_id);

    const nameOf = (id: string | null) =>
      id ? (members ?? []).find((m) => m.id === id)?.display_name ?? 'someone' : null;

    const payload = unphrased.map((f) => ({
      id: f.id,
      kind: f.kind,
      about: nameOf(f.member_id),
      and: nameOf(f.member_b_id),
      numbers: f.evidence,
    }));

    let notes: Note[];
    try {
      const out = await generateJson<{ notes?: Note[] }>(SYSTEM, JSON.stringify({ flags: payload }), 0.5);
      notes = out.notes ?? [];
    } catch (e) {
      console.error('flag phrasing failed:', e);
      // The flags themselves are still valid; only the wording is missing.
      return json({ flags, phrased: 0, warning: 'Could not write summaries right now.' });
    }

    const validIds = new Set(unphrased.map((f) => f.id));
    let phrased = 0;

    for (const n of notes) {
      if (!n?.id || !validIds.has(n.id)) continue;

      //same moderation gate as the hint chat, plus the clinical lang filter
      const checked = moderateParentNote(String(n.message ?? ''));
      const text = checked.ok ? checked.text : checked.replacement;
      if (!checked.ok) console.error(`[monitor] moderation blocked: ${checked.reason}`);

      const { error: upErr } = await admin
        .from('engagement_flags')
        .update({ message: text.slice(0, 400) })
        .eq('id', n.id)
        .eq('family_id', family_id);

      if (!upErr) phrased += 1;
    }

    const { data: finalFlags } = await admin
      .from('engagement_flags')
      .select('id, member_id, member_b_id, kind, severity, evidence, message, detected_at')
      .eq('family_id', family_id)
      .eq('status', 'open')
      .order('severity', { ascending: false })
      .order('detected_at', { ascending: false });

    console.log(`[monitor] family=${family_id} open=${finalFlags?.length ?? 0} phrased=${phrased}`);

    return json({ flags: finalFlags ?? [], phrased, model: GEMINI_MODEL });
  } catch (e) {
    console.error('engagement-monitor failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}