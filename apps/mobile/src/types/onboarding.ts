//interests
export type InterestCategory = { key: string; label: string; sort_order: number };

export type FamilyMemberRow = {
  id: string;
  display_name: string;
  role: 'parent' | 'caregiver' | 'child';
  birth_year: number | null;
};

export const WEIGHT_LABELS = ['Nope', "It's OK", 'Like it', 'Love it'];

//caregiver survey (runs last + for any caregiver who later signs in 
//low domain score -> MORE need
export type SkillDomain = 'active_listening' | 'emotional_support' | 'constructive_discipline' | 'safe_tech_use';
export type OptionKey = 'A' | 'B' | 'C' | 'D';

export type SurveyQuestion = {
  key: string;
  scenario: string;
  options: { key: OptionKey; text: string }[];
  scores: Record<OptionKey, number>;
  domains: SkillDomain[];
};

export const CAREGIVER_SURVEY_INTRO =
  'You will be presented with a few scenarios involving you and your child. Choose the response that feels closest to what you would usually do. There are no right or wrong answers.';

export const CAREGIVER_SURVEY: SurveyQuestion[] = [
  { key: 'cs_1', scenario: 'Your child comes to you upset about something that happened during their day. What would you usually do?',
    options: [
      { key: 'A', text: 'Ask what happened, then help them think through what to do.' },
      { key: 'B', text: 'Ask what happened and share what you think they should do.' },
      { key: 'C', text: 'Give them some time alone before talking about it.' },
      { key: 'D', text: 'Reassure them that it probably isn\u2019t a big deal.' }],
    scores: { A: 3, B: 2, C: 2, D: 0 },
    domains: ['active_listening', 'emotional_support'] },
  { key: 'cs_2', scenario: 'Your child keeps breaking a family rule you\u2019ve already discussed. What would you usually do?',
    options: [
      { key: 'A', text: 'Explain again why the rule is important and leave it there.' },
      { key: 'B', text: 'Ask why they\u2019ve been having trouble following the rule.' },
      { key: 'C', text: 'Remind them of the rule and follow through with a related consequence.' },
      { key: 'D', text: 'Give a stronger consequence so they understand you mean it.' }],
    scores: { A: 2, B: 2, C: 3, D: 0 },
    domains: ['constructive_discipline'] },
  { key: 'cs_3', scenario: 'Your child becomes angry after you say no to something they want. What would you usually do?',
    options: [
      { key: 'A', text: 'Give them some space until they are ready to talk.' },
      { key: 'B', text: 'Acknowledge that they\u2019re disappointed while keeping your decision.' },
      { key: 'C', text: 'Explain why your decision is reasonable and ask them to accept it.' },
      { key: 'D', text: 'Offer them something else to help settle things down.' }],
    scores: { A: 2, B: 3, C: 1, D: 2 },
    domains: ['emotional_support'] },
  { key: 'cs_4', scenario: 'Your child wants to start using a new app or online game. What would you usually do?',
    options: [
      { key: 'A', text: 'Check whether it seems appropriate and talk about how they\u2019ll use it.' },
      { key: 'B', text: 'Set limits around when they can use it and what they can share.' },
      { key: 'C', text: 'Let them try it first and step in if something goes wrong.' },
      { key: 'D', text: 'Look at the age rating and let them decide whether to use it.' }],
    scores: { A: 3, B: 2, C: 1, D: 2 },
    domains: ['safe_tech_use'] },
  { key: 'cs_5', scenario: 'You are already stressed, and your child is becoming increasingly difficult to manage. What would you usually do?',
    options: [
      { key: 'A', text: 'Address the behavior immediately so the situation doesn\u2019t escalate.' },
      { key: 'B', text: 'Give your child some space and return to the issue later.' },
      { key: 'C', text: 'Try to end the situation quickly and discuss it another time.' },
      { key: 'D', text: 'Take a moment to settle yourself, then set a clear boundary.' }],
    scores: { A: 2, B: 2, C: 1, D: 3 },
    domains: ['emotional_support', 'constructive_discipline'] },
];

export const ALL_DOMAINS: SkillDomain[] = ['active_listening', 'emotional_support', 'constructive_discipline', 'safe_tech_use'];

//domain score = mean of the scores of revelant qs
export function scoreDomains(answers: Record<string, OptionKey>): Record<SkillDomain, number | null> {
  const acc: Record<string, number[]> = {};
  for (const d of ALL_DOMAINS) acc[d] = [];
  for (const q of CAREGIVER_SURVEY) {
    const picked = answers[q.key];
    if (!picked) continue;
    const s = q.scores[picked];
    for (const d of q.domains) acc[d].push(s);
  }
  const out: Record<string, number | null> = {};
  for (const d of ALL_DOMAINS) {
    out[d] = acc[d].length ? acc[d].reduce((a, b) => a + b, 0) / acc[d].length : null;
  }
  return out as Record<SkillDomain, number | null>;
}

//lowest scoring domains = greatest need
export function skillFocusFrom(answers: Record<string, OptionKey>, take = 2): SkillDomain[] {
  const scores = scoreDomains(answers);
  return ALL_DOMAINS
    .filter((d) => scores[d] !== null)
    .sort((a, b) => (scores[a]! - scores[b]!) || a.localeCompare(b))
    .slice(0, take);
}

//fisher yates used to randomise question and option order per session
export function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}