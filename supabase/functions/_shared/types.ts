export type GeneratedProfile = {
  summary: string;
  interest_weights: Record<string, number>;
  dynamics: {
    notes: string;
    under_connected_pairs: string[][];
  };
  skill_focus: string[];
  skill_rationale: string;
};

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};