export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type SkillDomain =
  | 'active_listening'
  | 'emotional_support'
  | 'constructive_discipline'
  | 'safe_tech_use';

export const ALL_DOMAINS: SkillDomain[] = [
  'active_listening', 'emotional_support', 'constructive_discipline', 'safe_tech_use',
];

//caregiver survey scoring key, duplicated cz client value is untrusted
export const SURVEY_KEY: Record<string, { scores: Record<string, number>; domains: SkillDomain[] }> = {
  cs_1: { scores: { A: 3, B: 2, C: 2, D: 0 }, domains: ['active_listening', 'emotional_support'] },
  cs_2: { scores: { A: 2, B: 2, C: 3, D: 0 }, domains: ['constructive_discipline'] },
  cs_3: { scores: { A: 2, B: 3, C: 1, D: 2 }, domains: ['emotional_support'] },
  cs_4: { scores: { A: 3, B: 2, C: 1, D: 2 }, domains: ['safe_tech_use'] },
  cs_5: { scores: { A: 2, B: 2, C: 1, D: 3 }, domains: ['emotional_support', 'constructive_discipline'] },
};

export type SurveyRow = { question_key: string; answer_text: string | null; answer_value: number | null };

//dmain score = mean across relevant questions
export function scoreDomains(rows: SurveyRow[]): Record<SkillDomain, number | null> {
  const acc: Record<string, number[]> = {};
  for (const d of ALL_DOMAINS) acc[d] = [];

  for (const r of rows) {
    const spec = SURVEY_KEY[r.question_key];
    if (!spec) continue;
    //recompute from the letter; fall back to stored only if the letter is missinhg
    const letter = (r.answer_text ?? '').trim().toUpperCase();
    const score = spec.scores[letter] ?? r.answer_value;
    if (score === null || score === undefined) continue;
    for (const d of spec.domains) acc[d].push(score);
  }

  const out: Record<string, number | null> = {};
  for (const d of ALL_DOMAINS) {
    out[d] = acc[d].length ? acc[d].reduce((a, b) => a + b, 0) / acc[d].length : null;
  }
  return out as Record<SkillDomain, number | null>;
}

//lowest score = greatest need
export function skillFocusFrom(rows: SurveyRow[], take = 2): SkillDomain[] {
  const s = scoreDomains(rows);
  return ALL_DOMAINS
    .filter((d) => s[d] !== null)
    .sort((a, b) => (s[a]! - s[b]!) || a.localeCompare(b))
    .slice(0, take);
}

export type GeneratedProfile = {
  summary: string;
  interest_weights: Record<string, number>;
  dynamics: { notes: string; under_connected_pairs: string[][] };
};

export type PhotoVerdict = {
  verified: boolean;
  reason: string;
  confidence?: number;
};