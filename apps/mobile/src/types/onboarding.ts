export type InterestCategory = {
  key: string;
  label: string;
  sort_order: number;
};

export type FamilyMemberRow = {
  id: string;
  display_name: string;
  role: 'parent' | 'caregiver' | 'child';
  birth_year: number | null;
};

//internal skill targets
export type SkillTarget =
  | 'active_listening'
  | 'constructive_discipline'
  | 'emotional_regulation'
  | 'tech_balance';

export type LikertQuestion = {
  key: string;
  prompt: string;
  skill: SkillTarget;
  reverse: boolean; //true = agreeing indicates MORE need for skill
};

export const LIKERT_QUESTIONS: LikertQuestion[] = [
  { key: 'al_1', skill: 'active_listening', reverse: false, prompt: 'When my child talks about their day, I give them my full attention.' },
  { key: 'al_2', skill: 'active_listening', reverse: true,  prompt: "I often finish my child's sentences or jump straight to advice." },
  { key: 'al_3', skill: 'active_listening', reverse: false, prompt: 'I can usually tell how my child is feeling before they tell me.' },

  { key: 'cd_1', skill: 'constructive_discipline', reverse: false, prompt: 'When a rule gets broken, I explain the reason behind the rule.' },
  { key: 'cd_2', skill: 'constructive_discipline', reverse: true,  prompt: "I raise my voice more often than I'd like to." },
  { key: 'cd_3', skill: 'constructive_discipline', reverse: false, prompt: 'Consequences in our home stay consistent from one day to the next.' },

  { key: 'er_1', skill: 'emotional_regulation', reverse: false, prompt: 'I stay calm when my child is upset.' },
  { key: 'er_2', skill: 'emotional_regulation', reverse: true,  prompt: 'I react in the moment and regret how I handled it later.' },
  { key: 'er_3', skill: 'emotional_regulation', reverse: false, prompt: 'My child hears me name my own feelings out loud.' },

  { key: 'tb_1', skill: 'tech_balance', reverse: false, prompt: 'We have clear limits on screen time that everyone agrees on.' },
  { key: 'tb_2', skill: 'tech_balance', reverse: true,  prompt: 'Screens are a regular source of conflict in our home.' },
  { key: 'tb_3', skill: 'tech_balance', reverse: false, prompt: 'I know what my child actually does on their devices.' },
];

export const TIME_QUESTION_KEY = 'ctx_weekday_time';

export const TIME_OPTIONS = [
  { value: 1, label: 'Under 30 minutes' },
  { value: 2, label: '30–60 minutes' },
  { value: 3, label: '1–2 hours' },
  { value: 4, label: 'More than 2 hours' },
];

export const LIKERT_LABELS = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'];
export const WEIGHT_LABELS = ['Nope', "It's OK", 'Like it', 'Love it'];