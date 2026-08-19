export type HintMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type PollOptionResult = {
  option_id: string;
  label: string;
  detail: string | null;
  sort_order: number;
  votes: number;
};

export type PollRow = {
  id: string;
  question: string;
  status: 'open' | 'closed';
  winning_option_id: string | null;
  created_at: string;
  closed_at: string | null;
};

export type SuggestedOption = { label: string; detail: string | null };

export type NearbyPlace = {
  name: string;
  lat: number;
  lon: number;
  kind: string;
  distance_m: number;
};

//metres for a nearby place, in words a child can read
export function formatDistance(m: number): string {
  if (m < 100) return 'a couple of minutes away';
  if (m < 1000) return `${m} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

//OSM/Google type strings are not user-facing
export function formatKind(kind: string): string {
  const map: Record<string, string> = {
    park: 'Park', garden: 'Garden', playground: 'Playground',
    nature_reserve: 'Nature reserve', wood: 'Woods',
    zoo: 'Zoo', aquarium: 'Aquarium', animal_shelter: 'Animal shelter',
    library: 'Library', books: 'Bookshop', book_store: 'Bookshop',
    museum: 'Museum', community_centre: 'Community centre',
    community_center: 'Community centre', arts_centre: 'Arts centre',
    art_gallery: 'Gallery', artwork: 'Public artwork',
    pitch: 'Sports pitch', sports_centre: 'Sports centre',
    sports_complex: 'Sports centre', bakery: 'Bakery',
    marketplace: 'Market', market: 'Market',
  };
  return map[kind] ?? 'Place';
}

//share of vote, guarding zero-total case
export function votePct(votes: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((votes / total) * 100);
}

export function totalVotes(results: PollOptionResult[]): number {
  return results.reduce((sum, r) => sum + r.votes, 0);
}