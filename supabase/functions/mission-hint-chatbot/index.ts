import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS } from '../_shared/types.ts';
import { moderateAssistantText, validateUserQuestion } from '../_shared/moderation.ts';

const DAILY_LIMIT = 30;
const HISTORY_TURNS = 6;

const SYSTEM = `You are a friendly helper inside a family activity app. A family member is
part-way through an activity and wants a nudge.

Return ONLY JSON: { "reply": string }

Rules:
- Reply in 1-3 short sentences. Plain, warm, no lists.
- Give a concrete next step, not encouragement alone.
- You may be talking to a child as young as five. Use simple words.
- Never suggest going anywhere alone, meeting anyone, sharing personal
  details, or keeping anything secret from their family. If they ask for help
  with something outside the activity, gently steer back to it.
- NEVER mention parenting skills, training, assessment, scoring, or that any
  activity has a hidden purpose. As far as anyone is concerned these are just
  fun family activities.
- If they seem stuck on materials they do not have, suggest a substitute from
  around the house.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const { assignment_id, member_id, question } = await req.json();
    if (!assignment_id || !question) {
      return json({ error: 'assignment_id and question are required' }, 400);
    }

    const check = validateUserQuestion(question);
    if (!check.ok) return json({ error: check.reason ?? 'invalid question' }, 400);

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

    //assignment must belong to callers family
    const { data: assignment } = await admin
      .from('mission_assignments')
      .select('id, family_id, missions ( title, description )')
      .eq('id', assignment_id)
      .maybeSingle();

    if (!assignment) return json({ error: 'mission not found' }, 404);
    if (assignment.family_id !== caller.family_id) {
      return json({ error: 'that mission is not yours' }, 403);
    }

    //rate limit BEFORE model call
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const { count: usedToday } = await admin
      .from('mission_hint_messages')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', caller.family_id)
      .eq('role', 'user')
      .gte('created_at', startOfDay.toISOString());

    if ((usedToday ?? 0) >= DAILY_LIMIT) {
      return json({
        error: 'Your family has used all its hints for today. They come back tomorrow.',
        quota_remaining: 0,
      }, 429);
    }

    //log question first, so quota is consumed even if the model fails
    await admin.from('mission_hint_messages').insert({
      family_id: caller.family_id,
      assignment_id,
      member_id: member_id ?? null,
      role: 'user',
      content: check.text,
    });

    const mission = assignment.missions as unknown as { title: string; description: string };

    const { data: history } = await admin
      .from('mission_hint_messages')
      .select('role, content')
      .eq('assignment_id', assignment_id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS);

    const transcript = (history ?? [])
      .reverse()
      .map((m) => `${m.role === 'user' ? 'Them' : 'You'}: ${m.content}`)
      .join('\n');

    let reply: string;
    try {
      const out = await generateJson<{ reply?: string }>(
        SYSTEM,
        `Activity: ${mission.title}
What they were asked to do: ${mission.description}

Conversation so far:
${transcript}

Reply to their latest message.`,
        0.6
      );
      reply = out.reply ?? '';
    } catch (e) {
      console.error('hint generation failed:', e);
      return json({ error: 'Hints are unavailable right now. Please try again shortly.' }, 503);
    }

    //moderate before anything reaches device
    const moderated = moderateAssistantText(reply);
    const finalText = moderated.ok ? moderated.text : moderated.replacement;
    const blocked = !moderated.ok;

    if (blocked) {
      console.error(`[hint] moderation blocked: ${moderated.reason}`);
    }

    await admin.from('mission_hint_messages').insert({
      family_id: caller.family_id,
      assignment_id,
      member_id: member_id ?? null,
      role: 'assistant',
      content: finalText,
      blocked,
      block_reason: blocked ? moderated.reason : null,
      model: GEMINI_MODEL,
    });

    return json({
      reply: finalText,
      quota_remaining: Math.max(0, DAILY_LIMIT - ((usedToday ?? 0) + 1)),
    });
  } catch (e) {
    console.error('mission-hint-chatbot failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}