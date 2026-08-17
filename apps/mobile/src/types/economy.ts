export type Balances = {
  family_id: string;
  points_balance: number;
  coins_balance: number;
  points_earned_total: number;
  coins_earned_total: number;
};

export type EggRow = {
  id: string;
  points_required: number;
  points_contributed: number;
  status: 'incubating' | 'hatched';
  animal_id: string | null;
};

export type ContributeResult = {
  egg_id: string;
  points_contributed: number;
  points_required: number;
  ready_to_hatch: boolean;
  points_balance: number;
};

export type HatchResult = {
  animal_id: string;
  common_name: string;
  rarity: number;
  habitat: string;
  fun_fact: string;
  image_key: string;
};

export type FamilyAnimal = {
  id: string;
  nickname: string | null;
  hatched_at: string;
  last_fed_at: string | null;
  times_fed: number;
  animals: {
    id: string;
    common_name: string;
    rarity: number;
    habitat: string;
    fun_fact: string;
    image_key: string;
  };
};

export type AvailableBuilding = {
  key: string;
  label: string;
  description: string;
  coin_cost: number;
  image_key: string;
  sort_order: number;
  already_built: boolean;
  unlocked: boolean;
};

export type PlacedBuilding = {
  id: string;
  building_key: string;
  grid_x: number;
  grid_y: number;
};

export const GRID_SIZE = 6;

export const RARITY_LABEL: Record<number, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Legendary',
};

export const RARITY_COLOR: Record<number, string> = {
  1: '#6b7280',
  2: '#2563eb',
  3: '#7c3aed',
  4: '#b45309',
};

/** Emoji stand-ins keyed off image_key so no remote assets are needed yet. */
export const ANIMAL_GLYPH: Record<string, string> = {
  fox: '🦊', hedgehog: '🦔', squirrel: '🐿️', sandcat: '🐱', turtle: '🐢',
  flamingo: '🦩', leopard: '🐆', oryx: '🦌', dugong: '🐋', panda: '🐼', vaquita: '🐬',
};

export const BUILDING_GLYPH: Record<string, string> = {
  tent: '⛺', firepit: '🔥', garden: '🌱', well: '🪣', workshop: '🔧',
  bakery: '🥖', library: '📚', barn: '🏚️', watchtower: '🗼', townhall: '🏛️',
};

export function eggProgressPct(e: EggRow | null): number {
  if (!e || e.points_required <= 0) return 0;
  return Math.min(100, Math.round((e.points_contributed / e.points_required) * 100));
}

export function fedToday(a: FamilyAnimal): boolean {
  if (!a.last_fed_at) return false;
  return new Date(a.last_fed_at).toDateString() === new Date().toDateString();
}