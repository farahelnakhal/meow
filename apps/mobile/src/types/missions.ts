export type MissionStatus = 'assigned' | 'submitted' | 'verified' | 'rejected' | 'skipped';

export type MissionRow = {
  id: string;
  title: string;
  description: string;
  category_key: string;
  est_cost: number;
  cost_tier: number;
  partners_required: number;
  requires_game: string | null;
  location_type: 'home' | 'local' | 'anywhere';
  points: number;
  coins: number;
  verification_prompt: string;
};

export type AssignmentRow = {
  id: string;
  status: MissionStatus;
  points_awarded: number;
  coins_awarded: number;
  assigned_at: string;
  completed_at: string | null;
  member_id: string;
  partner_member_id: string | null;
  partner2_member_id: string | null;
  missions: MissionRow;
};

export type MemberLookup = Record<string, string>;

//ission text is stored as {X} is partner 1 {Y} is 2
export function resolveTemplate(
  text: string,
  partnerName: string | null,
  partner2Name: string | null
): string {
  return text
    .replace(/\{X\}/g, partnerName ?? 'someone in your family')
    .replace(/\{Y\}/g, partner2Name ?? 'someone else in your family');
}

export function resolveAssignment(a: AssignmentRow, members: MemberLookup) {
  const x = a.partner_member_id ? members[a.partner_member_id] ?? null : null;
  const y = a.partner2_member_id ? members[a.partner2_member_id] ?? null : null;
  return {
    title: resolveTemplate(a.missions.title, x, y),
    description: resolveTemplate(a.missions.description, x, y),
    partnerNames: [x, y].filter(Boolean) as string[],
  };
}

export const COST_TIER_LABEL = ['Free', 'Under $10', '$10-20', 'Over $20'];