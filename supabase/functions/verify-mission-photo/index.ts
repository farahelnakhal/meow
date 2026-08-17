import { createClient } from '@supabase/supabase-js';
import { verifyImageJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS } from '../_shared/types.ts';
import { sha256Hex } from '../_shared/imageHash.ts';

const BUCKET = 'mission-proofs';

//0-10 scale, accept at or above
const ACCEPT_AT = 5; //false accept costs a few points,false reject costs motivation

const SYSTEM = `You check whether a photo is plausibly from a family doing an activity together.

Return ONLY JSON: { "match": number, "reason": string }

"match" is 0 to 10 for how consistent the photo is with the activity described.

Scoring guide:
- 8-10: clearly shows the activity or its result
- 5-7: shows something related -- the materials, the setting, a partial result,
  or the activity mid-way
- 3-4: ambiguous, but nothing contradicts the activity
- 0-2: blank, black, unrelated to any family activity, or an obvious download
  or screenshot of stock imagery

Default to being generous. These are children and parents with phone cameras.
Bad lighting, blur, odd angles, mess, half-finished results and things being
held up to the camera should all score well. You are not judging quality,
effort, or whether it looks nice.

Do not require every listed detail to be present. Do not require a specific
number of objects or people. Do not require faces. Never comment on who is in
the photo, their appearance, age or identity.

"reason" is one short warm sentence for the family. If the score is low, say
what to photograph instead.`;

type Verdict = { match?: number; reason?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const { assignment_id, storage_path } = await req.json();
    if (!assignment_id || !storage_path) {
      return json({ error: 'assignment_id and storage_path are required' }, 400);
    }

    // 1. establish who is calling, under their own JWT and RLS
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

    // 2.client is not allowed to write submissions or award points
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: assignment, error: aErr } = await admin
      .from('mission_assignments')
      .select(
        'id, family_id, member_id, status, missions ( title, description, verification_prompt, points, coins )'
      )
      .eq('id', assignment_id)
      .maybeSingle();

    if (aErr) throw new Error(`assignment lookup failed: ${aErr.message}`);
    if (!assignment) return json({ error: 'assignment not found' }, 404);

    // caller must own this assignment's family
    if (assignment.family_id !== caller.family_id) {
      return json({ error: 'assignment does not belong to your family' }, 403);
    }
    if (assignment.status === 'verified') {
      return json({ error: 'this mission is already complete' }, 409);
    }
    // storage path is namespaced by family; reject anything outside it
    if (!String(storage_path).startsWith(`${assignment.family_id}/`)) {
      return json({ error: 'storage path outside your family namespace' }, 403);
    }

    // 3. pull uploaded bytes back down and hash them
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storage_path);
    if (dlErr || !blob) throw new Error(`could not read uploaded photo: ${dlErr?.message}`);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 1024) {
      return json({
        verified: false,
        match: 0,
        reason: 'That image looks empty. Try taking the photo again.',
        can_request_approval: false,
      });
    }
    const hash = await sha256Hex(bytes);

    // 4. duplicate check bfr spending a Gemini call
    const { data: dupe } = await admin
      .from('mission_submissions')
      .select('id')
      .eq('family_id', assignment.family_id)
      .eq('image_hash', hash)
      .eq('status', 'verified')
      .maybeSingle();

    if (dupe) {
      await admin.from('mission_submissions').insert({
        assignment_id,
        family_id: assignment.family_id,
        member_id: assignment.member_id,
        storage_path,
        image_hash: hash,
        status: 'rejected',
        ai_reason: 'duplicate of an earlier accepted photo',
        decided_by: 'ai',
        model: null,
      });
      return json({
        verified: false,
        duplicate: true,
        match: 0,
        reason: 'This exact photo has already been used for another mission. Take a new one.',
        // a reused photo must never be manually approvable, or dedup is pointless
        can_request_approval: false,
      });
    }

    // 5. Verify, model sees missions own title and description
    const mission = assignment.missions as unknown as {
      title: string;
      description: string;
      verification_prompt: string;
      points: number;
      coins: number;
    };

    const b64 = base64FromBytes(bytes);
    const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';

    let verdict: Verdict;
    try {
      verdict = await verifyImageJson<Verdict>(
        SYSTEM,
        `Activity: ${mission.title}
What the family was asked to do: ${mission.description}
A photo of this might show: ${mission.verification_prompt}

Score how consistent the photo is with this activity.`,
        b64,
        mimeType
      );
    } catch (e) {
      //model failure must not consume the attempt or award anything.
      console.error('gemini verification failed:', e);
      return json({ error: 'Verification is unavailable right now. Please try again shortly.' }, 503);
    }

    const match = typeof verdict.match === 'number' ? verdict.match : 0;
    const verified = match >= ACCEPT_AT;

    // logged so ACCEPT_AT can be tuned against real photos
    console.log(`[verify] ${mission.title} -> match=${match} verified=${verified}`);

    // 6. record the submission, then award only if verified
    const { error: subErr } = await admin.from('mission_submissions').insert({
      assignment_id,
      family_id: assignment.family_id,
      member_id: assignment.member_id,
      storage_path,
      image_hash: hash,
      status: verified ? 'verified' : 'rejected',
      ai_verdict: { match, reason: verdict.reason ?? null, accept_at: ACCEPT_AT },
      ai_reason: verdict.reason ?? null,
      decided_by: 'ai',
      model: GEMINI_MODEL,
    });

    //race on unique hash index means someone else just used this photo
    if (subErr) {
      if (String(subErr.code) === '23505') {
        return json({
          verified: false,
          duplicate: true,
          match: 0,
          reason: 'This exact photo has already been used for another mission. Take a new one.',
          can_request_approval: false,
        });
      }
      throw new Error(`submission write failed: ${subErr.message}`);
    }

    if (verified) {
      const { error: updErr } = await admin
        .from('mission_assignments')
        .update({
          status: 'verified',
          points_awarded: mission.points,
          coins_awarded: mission.coins,
          completed_at: new Date().toISOString(),
        })
        .eq('id', assignment_id)
        .in('status', ['assigned', 'submitted']); // never double-award

      if (updErr) throw new Error(`award failed: ${updErr.message}`);
    }

    return json({
      verified,
      match,
      reason: verdict.reason ?? (verified ? 'Nice work.' : 'That photo does not show the mission yet.'),
      points: verified ? mission.points : 0,
      coins: verified ? mission.coins : 0,
      can_request_approval: !verified,
    });
  } catch (e) {
    console.error('verify-mission-photo failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

//chunked so a large photo cannot blow argument limit of String.fromCharCode
function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}