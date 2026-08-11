import { createClient } from '@supabase/supabase-js';
import { verifyImageJson, GEMINI_MODEL } from '../_shared/geminiClient.ts';
import { CORS_HEADERS, type PhotoVerdict } from '../_shared/types.ts';
import { sha256Hex } from '../_shared/imageHash.ts';

const BUCKET = 'mission-proofs';

const SYSTEM = `You verify whether a photo shows that a family activity was actually completed.

Return ONLY JSON: { "verified": boolean, "reason": string, "confidence": number }

Rules:
- verified=true only if the photo plausibly shows what the criterion describes.
- Be generous about photo quality, lighting, framing and skill. These are
  families with phone cameras, not photographers. A blurry but clearly correct
  photo passes.
- Be strict about substance: a screenshot of a web image, an unrelated scene,
  or a blank/dark frame fails.
- Do NOT require faces to be visible. Never comment on who is in the photo,
  their appearance, age or identity.
- reason is one short sentence addressed to the family, warm and specific.
  If it fails, say what to photograph instead.
- confidence is 0 to 1.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization header' }, 401);

    const { assignment_id, storage_path } = await req.json();
    if (!assignment_id || !storage_path) {
      return json({ error: 'assignment_id and storage_path are required' }, 400);
    }

    // 1.establish who is calling under their own JWT and RLS
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

    // 2.everything past here uses service_role: the client is not allowed to write submissions
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: assignment, error: aErr } = await admin
      .from('mission_assignments')
      .select('id, family_id, member_id, status, missions ( verification_prompt, points, coins )')
      .eq('id', assignment_id)
      .maybeSingle();

    if (aErr) throw new Error(`assignment lookup failed: ${aErr.message}`);
    if (!assignment) return json({ error: 'assignment not found' }, 404);

    //caller must own this assignments family
    if (assignment.family_id !== caller.family_id) {
      return json({ error: 'assignment does not belong to your family' }, 403);
    }
    if (assignment.status === 'verified') {
      return json({ error: 'this mission is already complete' }, 409);
    }
    //storage path is namespaced by family; reject anything outside it
    if (!String(storage_path).startsWith(`${assignment.family_id}/`)) {
      return json({ error: 'storage path outside your family namespace' }, 403);
    }

    // 3.pull uploaded bytes back down and hash them
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storage_path);
    if (dlErr || !blob) throw new Error(`could not read uploaded photo: ${dlErr?.message}`);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 1024) {
      return json({ verified: false, reason: 'That image looks empty. Try taking the photo again.' });
    }
    const hash = await sha256Hex(bytes);

    // 4.duplicate check bfr spending a gemini call
    const { data: dupe } = await admin
      .from('mission_submissions')
      .select('id')
      .eq('family_id', assignment.family_id)
      .eq('image_hash', hash)
      .eq('status', 'verified')
      .maybeSingle();

    if (dupe) {
      await admin.from('mission_submissions').insert({
        assignment_id, family_id: assignment.family_id, member_id: assignment.member_id,
        storage_path, image_hash: hash, status: 'rejected',
        ai_reason: 'duplicate of an earlier accepted photo', model: null,
      });
      return json({
        verified: false, duplicate: true,
        reason: 'This exact photo has already been used for another mission. Take a new one.',
      });
    }

    // 5. Verify
    const mission = assignment.missions as unknown as {
      verification_prompt: string; points: number; coins: number;
    };

    const b64 = base64FromBytes(bytes);
    const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';

    let verdict: PhotoVerdict;
    try {
      verdict = await verifyImageJson<PhotoVerdict>(
        SYSTEM,
        `Completion criterion: ${mission.verification_prompt}\n\nDoes the photo satisfy it?`,
        b64,
        mimeType
      );
    } catch (e) {
      //model failure must not consume the attempt or award anything.
      console.error('gemini verification failed:', e);
      return json({ error: 'Verification is unavailable right now. Please try again shortly.' }, 503);
    }

    const verified = verdict.verified === true;

    // 6.record submission then award only if verified
    const { error: subErr } = await admin.from('mission_submissions').insert({
      assignment_id, family_id: assignment.family_id, member_id: assignment.member_id,
      storage_path, image_hash: hash,
      status: verified ? 'verified' : 'rejected',
      ai_verdict: verdict, ai_reason: verdict.reason ?? null, model: GEMINI_MODEL,
    });

    //race on unique hash index means someone else just used photo
    if (subErr) {
      if (String(subErr.code) === '23505') {
        return json({
          verified: false, duplicate: true,
          reason: 'This exact photo has already been used for another mission. Take a new one.',
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
        .in('status', ['assigned', 'submitted']);   // never double-award

      if (updErr) throw new Error(`award failed: ${updErr.message}`);
    }

    return json({
      verified,
      reason: verdict.reason ?? (verified ? 'Nice work.' : 'That photo does not show the mission yet.'),
      points: verified ? mission.points : 0,
      coins: verified ? mission.coins : 0,
    });
  } catch (e) {
    console.error('verify-mission-photo failed:', e);
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

//chunked so large photo cannot blow the argument limit of String.fromCharCode
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