import { supabase } from '../supabaseClient';

export async function generateFamilyProfile(familyId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('generate-family-profile', {
      body: { family_id: familyId },
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'Edge function call failed' };
  }
}