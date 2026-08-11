import { supabase } from '../supabaseClient';

export async function generateFamilyProfile(familyId: string, timeoutMs = 25000) {
  try {
    const call = supabase.functions.invoke('generate-family-profile', {
      body: { family_id: familyId },
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`generate-family-profile timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    );

    const { data, error } = (await Promise.race([call, timeout])) as any;
    if (error) return { data: null, error: error.message ?? String(error) };
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'Edge function call failed' };
  }
}