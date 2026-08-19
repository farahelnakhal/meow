import { supabase } from '../supabaseClient';
import type {
  HintMessage, PollOptionResult, PollRow, SuggestedOption, NearbyPlace,
} from '../../types/social';

const TIMEOUT_MS = 25000;

function withTimeout<T>(p: PromiseLike<T>, label: string, ms = TIMEOUT_MS): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([p, timeout]);
}

//hints

export async function getHintHistory(assignmentId: string) {
  const { data, error } = await supabase
    .from('mission_hint_messages')
    .select('id, role, content, created_at')
    .eq('assignment_id', assignmentId)
    .order('created_at');
  return { data: (data ?? []) as HintMessage[], error: error?.message ?? null };
}

export async function getHintQuota(familyId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('hint_quota_remaining', { p_family_id: familyId }),
      'hint_quota_remaining'
    );
    if (error) return { remaining: null, error: error.message };
    return { remaining: (data as unknown as number) ?? 0, error: null };
  } catch (e: any) {
    return { remaining: null, error: e?.message ?? 'failed' };
  }
}

export async function askHint(assignmentId: string, memberId: string | null, question: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('mission-hint-chatbot', {
        body: { assignment_id: assignmentId, member_id: memberId, question },
      }),
      'mission-hint-chatbot',
      35000
    );
    if (error) return { data: null, error: error.message ?? String(error) };
    return { data: data as { reply: string; quota_remaining: number }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

//nearby

export async function findNearby(memberId: string | null, lat: number, lon: number) {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('locations-near-me', {
        body: { member_id: memberId, lat, lon },
      }),
      'locations-near-me',
      35000
    );
    if (error) return { data: null, error: error.message ?? String(error) };
    return {
      data: data as { places: NearbyPlace[]; radius_meters: number; provider: string },
      error: null,
    };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

//polls

export async function getOpenPoll(familyId: string) {
  const { data, error } = await supabase
    .from('polls')
    .select('id, question, status, winning_option_id, created_at, closed_at')
    .eq('family_id', familyId)
    .eq('status', 'open')
    .maybeSingle();
  return { data: (data ?? null) as PollRow | null, error: error?.message ?? null };
}

export async function getLatestClosedPoll(familyId: string) {
  const { data, error } = await supabase
    .from('polls')
    .select('id, question, status, winning_option_id, created_at, closed_at')
    .eq('family_id', familyId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: (data ?? null) as PollRow | null, error: error?.message ?? null };
}

export async function getPollResults(pollId: string) {
  const { data, error } = await supabase
    .from('poll_results')
    .select('option_id, label, detail, sort_order, votes')
    .eq('poll_id', pollId)
    .order('sort_order');
  return { data: (data ?? []) as PollOptionResult[], error: error?.message ?? null };
}

export async function getMyVote(pollId: string, memberId: string) {
  const { data, error } = await supabase
    .from('poll_votes')
    .select('option_id')
    .eq('poll_id', pollId)
    .eq('member_id', memberId)
    .maybeSingle();
  return { optionId: data?.option_id ?? null, error: error?.message ?? null };
}

export async function suggestPollOptions(occasion: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('suggest-poll-activities', { body: { occasion } }),
      'suggest-poll-activities',
      35000
    );
    if (error) return { data: null, error: error.message ?? String(error) };
    return { data: data as { question: string; options: SuggestedOption[] }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

export async function createPoll(
  familyId: string, question: string, options: string[], details: (string | null)[]
) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('create_poll', {
        p_family_id: familyId,
        p_question: question,
        p_options: options,
        p_details: details,
      }),
      'create_poll'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as { poll_id: string }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

export async function castVote(optionId: string, memberId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('cast_poll_vote', { p_option_id: optionId, p_member_id: memberId }),
      'cast_poll_vote'
    );
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as { poll_id: string }, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}

export async function closePoll(pollId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('close_poll', { p_poll_id: pollId }),
      'close_poll'
    );
    if (error) return { data: null, error: error.message };
    return {
      data: data as unknown as { winning_label: string; votes: number },
      error: null,
    };
  } catch (e: any) {
    return { data: null, error: e?.message ?? 'failed' };
  }
}