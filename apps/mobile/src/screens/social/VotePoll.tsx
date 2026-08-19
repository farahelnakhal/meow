import React, { useCallback, useState } from 'react';
import { View, Text, Button, ActivityIndicator, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { readActiveProfile } from '../../store/activeProfile';
import { getMyFamilyId, getFamilyMembers } from '../../services/api/missions';
import {
  getOpenPoll, getLatestClosedPoll, getPollResults, getMyVote, castVote, closePoll,
} from '../../services/api/social';
import { votePct, totalVotes, type PollRow, type PollOptionResult } from '../../types/social';

export default function VotePoll() {
  const navigation = useNavigation<any>();
  const [poll, setPoll] = useState<PollRow | null>(null);
  const [results, setResults] = useState<PollOptionResult[]>([]);
  const [myOptionId, setMyOptionId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [isCaregiver, setIsCaregiver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { familyId, error: famErr } = await getMyFamilyId();
      if (!familyId) return setError(famErr ?? 'No family found.');

      const mid = await readActiveProfile();
      setMemberId(mid);

      // whether the active profile may close the poll
      const { data: members } = await getFamilyMembers(familyId);
      const me = members.find((m: any) => m.id === mid);
      setIsCaregiver(me ? ['parent', 'caregiver'].includes(me.role) : false);

      // show the open poll, or the most recent closed one as a result card
      let current: PollRow | null = null;
      const open = await getOpenPoll(familyId);
      if (open.error) return setError(open.error);
      current = open.data;

      if (!current) {
        const closed = await getLatestClosedPoll(familyId);
        if (closed.error) return setError(closed.error);
        current = closed.data;
      }

      setPoll(current);

      if (current) {
        const [r, v] = await Promise.all([
          getPollResults(current.id),
          mid ? getMyVote(current.id, mid) : Promise.resolve({ optionId: null, error: null }),
        ]);
        if (r.error) return setError(r.error);
        setResults(r.data);
        setMyOptionId(v.optionId);
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load the poll.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const vote = async (optionId: string) => {
    if (!memberId) {
      Alert.alert('No profile', 'Pick who you are first.');
      return;
    }
    setBusy(true);
    const { error: vErr } = await castVote(optionId, memberId);
    setBusy(false);
    if (vErr) {
      Alert.alert('Could not vote', vErr);
      return;
    }
    await load();
  };

  const finish = async () => {
    if (!poll) return;
    setBusy(true);
    const { data, error: cErr } = await closePoll(poll.id);
    setBusy(false);
    if (cErr) {
      Alert.alert('Could not close the poll', cErr);
      return;
    }
    Alert.alert('Poll closed', `The winner is ${data?.winning_label ?? 'decided'}.`);
    await load();
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>poll: loading</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 }}>
        <Text style={{ textAlign: 'center' }}>{error}</Text>
        <Button title="Retry" onPress={() => { setLoading(true); load(); }} />
      </View>
    );
  }

  if (!poll) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14 }}>
        <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center' }}>No poll yet</Text>
        <Text style={{ color: '#666', textAlign: 'center', lineHeight: 21 }}>
          A grown-up can start one to decide something together.
        </Text>
        {isCaregiver ? (
          <Button title="Create a poll" onPress={() => navigation.navigate('CreatePoll')} />
        ) : null}
        <Button title="Back" color="#777" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const total = totalVotes(results);
  const closed = poll.status === 'closed';

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 16, paddingBottom: 40 }}>
      <View>
        <Text style={{ fontSize: 22, fontWeight: 'bold' }}>{poll.question}</Text>
        <Text style={{ color: '#666', marginTop: 4 }}>
          {closed ? 'This poll is closed.' : `${total} vote${total === 1 ? '' : 's'} so far.`}
          {!closed && myOptionId ? ' You have voted.' : ''}
        </Text>
      </View>

      {results.map((r) => {
        const mine = r.option_id === myOptionId;
        const won = closed && poll.winning_option_id === r.option_id;
        const pct = votePct(r.votes, total);
        return (
          <TouchableOpacity
            key={r.option_id}
            disabled={closed || busy}
            onPress={() => vote(r.option_id)}
            style={{
              borderWidth: won ? 2 : 1,
              borderColor: won ? '#15803d' : mine ? '#333' : '#ddd',
              borderRadius: 10, padding: 14, gap: 8,
              opacity: closed && !won ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', flex: 1 }}>
                {r.label}{won ? '  ✓' : ''}
              </Text>
              <Text style={{ fontSize: 13, color: '#777' }}>
                {r.votes} · {pct}%
              </Text>
            </View>

            {r.detail ? (
              <Text style={{ fontSize: 12, color: '#777', lineHeight: 17 }}>{r.detail}</Text>
            ) : null}

            <View style={{ height: 8, backgroundColor: '#eee', borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ height: 8, width: `${pct}%`, backgroundColor: won ? '#15803d' : '#2563eb' }} />
            </View>

            {mine && !closed ? (
              <Text style={{ fontSize: 11, color: '#333' }}>Your vote — tap another to change it</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}

      {busy ? <ActivityIndicator /> : null}

      <View style={{ gap: 10, marginTop: 6 }}>
        {!closed && isCaregiver ? (
          <Button title="Close the poll" onPress={finish} disabled={busy} />
        ) : null}
        {closed && isCaregiver ? (
          <Button title="Start a new poll" onPress={() => navigation.navigate('CreatePoll')} />
        ) : null}
        <Button title="Back" color="#777" onPress={() => navigation.goBack()} />
      </View>
    </ScrollView>
  );
}