import { supabase } from '../supabaseClient';
import type { AssignmentRow, MemberLookup } from '../../types/missions';

const TIMEOUT_MS = 25000;

function withTimeout<T>(p: PromiseLike<T>, label: string, ms = TIMEOUT_MS): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([p, timeout]);
}

//resolves the signed in accs family id via own member row
export async function getMyFamilyId(): Promise<{ familyId: string | null; error: string | null }> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return { familyId: null, error: 'No signed-in user.' };

    const { data, error } = await supabase
      .from('family_members')
      .select('family_id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (error) return { familyId: null, error: error.message };
    if (!data) return { familyId: null, error: 'No family found for this account.' };
    return { familyId: data.family_id, error: null };
  } catch (e: any) {
    return { familyId: null, error: e?.message ?? 'Lookup failed' };
  }
}

export async function getFamilyMembers(familyId: string) {
  const { data, error } = await supabase
    .from('family_members')
    .select('id, display_name, role, birth_year')
    .eq('family_id', familyId)
    .order('created_at');
  return { data: data ?? [], error: error?.message ?? null };
}

export function memberLookupFrom(members: { id: string; display_name: string }[]): MemberLookup {
  return members.reduce<MemberLookup>((acc, m) => {
    acc[m.id] = m.display_name;
    return acc;
  }, {});
}

//deterministic serverside assignment
export async function assignMissions(familyId: string, perMember = 3) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('assign_missions_for_family', {
        p_family_id: familyId,
        p_per_member: perMember,
      }),
      'assign_missions_for_family'
    );
    if (error) return { inserted: 0, error: error.message };
    return { inserted: (data as number) ?? 0, error: null };
  } catch (e: any) {
    return { inserted: 0, error: e?.message ?? 'Assignment failed' };
  }
}

export async function getOpenAssignments(memberId: string) {
  const { data, error } = await supabase
    .from('mission_assignments')
    .select(
      `id, status, points_awarded, coins_awarded, assigned_at, completed_at,
       member_id, partner_member_id, partner2_member_id,
       missions ( id, title, description, category_key, est_cost, cost_tier,
                  partners_required, requires_game, location_type, points, coins,
                  verification_prompt )`
    )
    .eq('member_id', memberId)
    .in('status', ['assigned', 'submitted'])
    .order('assigned_at', { ascending: false });

  return { data: (data ?? []) as unknown as AssignmentRow[], error: error?.message ?? null };
}

export async function getCompletedAssignments(memberId: string) {
  const { data, error } = await supabase
    .from('mission_assignments')
    .select(
      `id, status, points_awarded, coins_awarded, assigned_at, completed_at,
       member_id, partner_member_id, partner2_member_id,
       missions ( id, title, description, category_key, est_cost, cost_tier,
                  partners_required, requires_game, location_type, points, coins,
                  verification_prompt )`
    )
    .eq('member_id', memberId)
    .eq('status', 'verified')
    .order('completed_at', { ascending: false });

  return { data: (data ?? []) as unknown as AssignmentRow[], error: error?.message ?? null };
}

//only status transition RLS allows client to make
export async function skipAssignment(assignmentId: string) {
  const { error } = await supabase
    .from('mission_assignments')
    .update({ status: 'skipped' })
    .eq('id', assignmentId);
  return { error: error?.message ?? null };
}

//uploads the proof photo then asks the edge function to verify it
export async function submitMissionPhoto(
  assignmentId: string,
  familyId: string,
  base64: string,
  mimeType: string
) {
  try {
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const path = `${familyId}/${assignmentId}-${Date.now()}.${ext}`;

    const bytes = decodeBase64(base64);
    const { error: upErr } = await withTimeout(
      supabase.storage.from('mission-proofs').upload(path, bytes, {
        contentType: mimeType,
        upsert: false,
      }),
      'storage upload'
    );
    if (upErr) return { verdict: null, error: `upload failed: ${upErr.message}` };

    const { data, error } = await withTimeout(
      supabase.functions.invoke('verify-mission-photo', {
        body: { assignment_id: assignmentId, storage_path: path },
      }),
      'verify-mission-photo',
      45000
    );
    if (error) return { verdict: null, error: error.message ?? String(error) };
    return { verdict: data, error: null };
  } catch (e: any) {
    return { verdict: null, error: e?.message ?? 'Submission failed' };
  }
}

//react native has no buffer and atob is unreliable across engines
function decodeBase64(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const byteLength = Math.floor((len * 3) / 4);
  const out = new Uint8Array(byteLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = chars.indexOf(clean[i]);
    const e2 = chars.indexOf(clean[i + 1]);
    const e3 = chars.indexOf(clean[i + 2]);
    const e4 = chars.indexOf(clean[i + 3]);
    const n = (e1 << 18) | (e2 << 12) | ((e3 < 0 ? 0 : e3) << 6) | (e4 < 0 ? 0 : e4);
    if (p < byteLength) out[p++] = (n >> 16) & 0xff;
    if (p < byteLength) out[p++] = (n >> 8) & 0xff;
    if (p < byteLength) out[p++] = n & 0xff;
  }
  return out;
}