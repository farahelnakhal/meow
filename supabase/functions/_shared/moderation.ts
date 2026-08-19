//utput moderation for anything model says to a child, cheap deterministic pass

export type ModerationResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; replacement: string };

//words that would reveal that some missions secretly target a parenting skill
const SKILL_LEAK = [
  'active listening',
  'emotional support',
  'constructive discipline',
  'safe tech use',
  'parenting skill',
  'parenting training',
  'skill mission',
  'skill target',
  'training module',
  'assessment score',
];

//anything that would send a child somewhere or to someone unsupervised
const UNSAFE_DIRECTION = [
  'go alone',
  'on your own without',
  'without telling',
  "don't tell your",
  'do not tell your',
  'keep it secret from',
  'meet a stranger',
  'meet someone new online',
  'send a photo to',
  'share your address',
  'share your phone number',
  'give them your name and',
];

//requests for identifying information
const PII_REQUEST = [
  'what is your address',
  'what is your full name',
  'what school do you go to',
  'what is your phone number',
  'where do you live',
];

const SAFE_FALLBACK =
  "Let's keep it simple: read the mission again and start with the first thing it asks for. If you're stuck, ask a grown-up in your family to help.";

function hit(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (haystack.includes(n)) return n;
  }
  return null;
}

//checks assistant output before it is shown
export function moderateAssistantText(raw: string): ModerationResult {
  const text = (raw ?? '').trim();

  if (!text) {
    return { ok: false, reason: 'empty response', replacement: SAFE_FALLBACK };
  }

  // Length cap matches the mission_hint_messages content constraint
  if (text.length > 1800) {
    return {
      ok: false,
      reason: 'response too long',
      replacement: text.slice(0, 1797).trimEnd() + '...',
    };
  }

  const lower = text.toLowerCase();

  const leak = hit(lower, SKILL_LEAK);
  if (leak) {
    return { ok: false, reason: `skill framing leaked: "${leak}"`, replacement: SAFE_FALLBACK };
  }

  const unsafe = hit(lower, UNSAFE_DIRECTION);
  if (unsafe) {
    return { ok: false, reason: `unsafe direction: "${unsafe}"`, replacement: SAFE_FALLBACK };
  }

  const pii = hit(lower, PII_REQUEST);
  if (pii) {
    return { ok: false, reason: `asked for personal info: "${pii}"`, replacement: SAFE_FALLBACK };
  }

  return { ok: true, text };
}

//sanity check on what a child typed before spending a model call, rejects empty ot oversized input
export function validateUserQuestion(raw: string): { ok: boolean; text: string; reason?: string } {
  const text = (raw ?? '').trim();
  if (text.length === 0) return { ok: false, text, reason: 'empty question' };
  if (text.length > 500) return { ok: false, text, reason: 'question too long' };
  return { ok: true, text };
}