import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Button, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { readActiveProfile } from '../../store/activeProfile';
import {
  getMyFamilyId, getFamilyMembers, memberLookupFrom, getOpenAssignments,
  assignMissions, generateMissions,
} from '../../services/api/missions';
import { resolveAssignment, COST_TIER_LABEL, type AssignmentRow, type MemberLookup } from '../../types/missions';

export default function MissionFeed() {
  const navigation = useNavigation<any>();
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [members, setMembers] = useState<MemberLookup>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const memberId = await readActiveProfile();
      if (!memberId) {
        setError('No active profile selected.');
        return;
      }

      const { familyId, error: famErr } = await getMyFamilyId();
      if (!familyId) {
        setError(famErr ?? 'No family found.');
        return;
      }

      const { data: mem, error: memErr } = await getFamilyMembers(familyId);
      if (memErr) {
        setError(memErr);
        return;
      }
      setMembers(memberLookupFrom(mem));

      const { data, error: aErr } = await getOpenAssignments(memberId);
      if (aErr) {
        setError(aErr);
        return;
      }
      setRows(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load missions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  //reload on focus so returning from a submission shows fresh state
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleGetMore = async () => {
    setAssigning(true);
    const { familyId } = await getMyFamilyId();
    if (familyId) await assignMissions(familyId, 3);
    setAssigning(false);
    await load();
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const { data, error: gErr } = await generateMissions();
    setGenerating(false);

    if (gErr) {
      Alert.alert('Could not add new missions', gErr);
      return;
    }

    Alert.alert(
      'New missions added',
      `${data?.created ?? 0} fresh ideas, made for your family:\n\n${(data?.titles ?? []).join('\n')}`
    );

    // pull them into the pool straight away
    const { familyId } = await getMyFamilyId();
    if (familyId) await assignMissions(familyId, 2);
    await load();
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>feed: loading missions</Text>
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

  const busy = assigning || generating;

  return (
    <View style={{ flex: 1, paddingTop: 56 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Your missions</Text>
        <TouchableOpacity onPress={() => navigation.navigate('ProfileSwitcher')} hitSlop={8}>
          <Text style={{ color: '#2563eb', fontSize: 13 }}>Switch</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Button title="Egg" onPress={() => navigation.navigate('EggOpening')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Village" onPress={() => navigation.navigate('SettlementBuilder')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Poll" onPress={() => navigation.navigate('VotePoll')} />
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 40 }}>
            <Text style={{ color: '#666', textAlign: 'center' }}>
              Nothing open right now.
            </Text>
            <Button
              title={assigning ? 'Finding missions...' : 'Get new missions'}
              onPress={handleGetMore}
              disabled={busy}
            />
          </View>
        }
        renderItem={({ item }) => {
          const { title, partnerNames } = resolveAssignment(item, members);
          return (
            <TouchableOpacity
              onPress={() => navigation.navigate('MissionDetail', { assignmentId: item.id })}
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, gap: 6 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{title}</Text>
              <Text style={{ fontSize: 12, color: '#777' }}>
                {COST_TIER_LABEL[item.missions.cost_tier]} · {item.missions.points} pts · {item.missions.coins} coins
                {partnerNames.length ? ` · with ${partnerNames.join(' & ')}` : ''}
              </Text>
              {item.missions.location_type === 'local' ? (
                <Text style={{ fontSize: 12, color: '#777' }}>Outside the house</Text>
              ) : null}
              {item.status === 'submitted' ? (
                <Text style={{ fontSize: 12, color: '#b8860b' }}>Waiting on verification</Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />

      <View style={{ padding: 20, gap: 10 }}>
        {rows.length > 0 ? (
          <Button
            title={assigning ? 'Finding missions...' : 'Get more missions'}
            onPress={handleGetMore}
            disabled={busy}
          />
        ) : null}
        <Button
          title={generating ? 'Thinking of new ideas...' : 'Invent new missions for us'}
          color="#7c3aed"
          onPress={handleGenerate}
          disabled={busy}
        />
      </View>
    </View>
  );
}