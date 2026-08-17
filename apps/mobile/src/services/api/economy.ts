import { supabase } from '../supabaseClient';
import type {
  Balances, EggRow, ContributeResult, HatchResult, FamilyAnimal,
  AvailableBuilding, PlacedBuilding,
} from '../../types/economy';

const TIMEOUT_MS = 20000;

function withTimeout<T>(p: PromiseLike<T>, label: string, ms = TIMEOUT_MS): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([p, timeout]);
}

export async function getBalances(familyId: string) {
  const { data, error } = await supabase
    .from('family_balances')
    .select('family_id, points_balance, coins_balance, points_earned_total, coins_earned_total')
    .eq('family_id', familyId)
    .maybeSingle();
  return { data: (data ?? null) as Balances | null, error: error?.message ?? null };
}

//eggs
export async function ensureEgg(familyId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('ensure_incubating_egg', { p_family_id: familyId }),
      'ensure_incubating_egg'
    );
    if (error) return { eggId: null, error: error.message };
    return { eggId: data as unknown as string, error: null };
  } catch (e: any) {
    return { eggId: null, error: e?.message ?? 'failed' };
  }
}

export async function getIncubatingEgg(familyId: string) {
  const { data, error } = await supabase
    .from('family_eggs')
    .select('id, points_required, points_contributed, status, animal_id')
    .eq('family_id', familyId)
    .eq('status', 'incubating')
    .maybeSingle();
  return { data: (data ?? null) as EggRow | null, error: error?.message ?? null };
}

export async function contributePoints(familyId: string, points: number) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('contribute_points_to_egg', { p_family_id: familyId, p_points: points }),
      'contribute_points_to_egg'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as ContributeResult, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

export async function hatchEgg(familyId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('hatch_egg', { p_family_id: familyId }),
      'hatch_egg'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as HatchResult, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

//collection
export async function getFamilyAnimals(familyId: string) {
  const { data, error } = await supabase
    .from('family_animals')
    .select(
      `id, nickname, hatched_at, last_fed_at, times_fed,
       animals ( id, common_name, rarity, habitat, fun_fact, image_key )`
    )
    .eq('family_id', familyId)
    .order('hatched_at', { ascending: false });
  return { data: (data ?? []) as unknown as FamilyAnimal[], error: error?.message ?? null };
}

export async function feedAnimal(familyAnimalId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('feed_animal', { p_family_animal_id: familyAnimalId }),
      'feed_animal'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as { times_fed: number; coins_balance: number }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

export async function renameAnimal(familyAnimalId: string, nickname: string) {
  const trimmed = nickname.trim().slice(0, 40);
  const { error } = await supabase
    .from('family_animals')
    .update({ nickname: trimmed.length ? trimmed : null })
    .eq('id', familyAnimalId);
  return { error: error?.message ?? null };
}

//settlement
export async function getAvailableBuildings(familyId: string) {
  const { data, error } = await supabase
    .from('available_buildings')
    .select('key, label, description, coin_cost, image_key, sort_order, already_built, unlocked')
    .eq('family_id', familyId)
    .order('sort_order');
  return { data: (data ?? []) as unknown as AvailableBuilding[], error: error?.message ?? null };
}

export async function getPlacedBuildings(familyId: string) {
  const { data, error } = await supabase
    .from('family_buildings')
    .select('id, building_key, grid_x, grid_y')
    .eq('family_id', familyId);
  return { data: (data ?? []) as unknown as PlacedBuilding[], error: error?.message ?? null };
}

export async function purchaseBuilding(
  familyId: string, buildingKey: string, gridX: number, gridY: number
) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('purchase_building', {
        p_family_id: familyId,
        p_building_key: buildingKey,
        p_grid_x: gridX,
        p_grid_y: gridY,
      }),
      'purchase_building'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as { coins_balance: number; label: string }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

//ratings
export async function rateMission(
  assignmentId: string, familyId: string, memberId: string, stars: number, note?: string
) {
  const { error } = await supabase
    .from('mission_ratings')
    .upsert(
      {
        assignment_id: assignmentId,
        family_id: familyId,
        member_id: memberId,
        stars,
        note: note?.trim().slice(0, 500) || null,
      },
      { onConflict: 'assignment_id' }
    );
  return { error: error?.message ?? null };
}

export async function getRating(assignmentId: string) {
  const { data, error } = await supabase
    .from('mission_ratings')
    .select('stars, note')
    .eq('assignment_id', assignmentId)
    .maybeSingle();
  return { data: (data ?? null) as { stars: number; note: string | null } | null, error: error?.message ?? null };
}

export async function approveManually(assignmentId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('approve_submission_manually', { p_assignment_id: assignmentId }),
      'approve_submission_manually'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as { points: number; coins: number }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}