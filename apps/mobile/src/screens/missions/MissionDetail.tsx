import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import {
  getMyFamilyId, getFamilyMembers, memberLookupFrom, skipAssignment,
} from '../../services/api/missions';
import { resolveAssignment, COST_TIER_LABEL, type AssignmentRow, type MemberLookup } from '../../types/missions';

export default function MissionDetail() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const assignmentId: string | undefined = route.params?.assignmentId;

  const [row, setRow] = useState<AssignmentRow | null>(null);
  const [members, setMembers] = useState<MemberLookup>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        if (!assignmentId) {
          setError('No mission was passed to this screen.');
          return;
        }

        const { familyId } = await getMyFamilyId();
        if (familyId) {
          const { data: mem } = await getFamilyMembers(familyId);
          setMembers(memberLookupFrom(mem));
        }

        const { data, error: e } = await supabase
          .from('mission_assignments')
          .select(
            `id, status, points_awarded, coins_awarded, assigned_at, completed_at,
             member_id, partner_member_id, partner2_member_id,
             missions ( id, title, description, category_key, est_cost, cost_tier,
                        partners_required, requires_game, location_type, points, coins,
                        verification_prompt )`
          )
          .eq('id', assignmentId)
          .maybeSingle();

        if (e) {
          setError(e.message);
          return;
        }
        if (!data) {
          setError('Mission not found.');
          return;
        }
        setRow(data as unknown as AssignmentRow);
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load mission.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [assignmentId]);

  const handleSkip = async () => {
    if (!row) return;
    setBusy(true);
    const { error: e } = await skipAssignment(row.id);
    setBusy(false);
    if (e) {
      Alert.alert('Could not skip', e);
      return;
    }
    navigation.goBack();
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>detail: loading mission</Text>
      </View>
    );
  }

  if (error || !row) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 }}>
        <Text style={{ textAlign: 'center' }}>{error ?? 'Mission unavailable.'}</Text>
        <Button title="Back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const { title, description, partnerNames } = resolveAssignment(row, members);
  const alreadySubmitted = row.status === 'submitted';
  // only offer nearby places for missions that actually involve going somewhere
  const goesOut = row.missions.location_type === 'local';

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{title}</Text>
      <Text style={{ fontSize: 16, lineHeight: 23, color: '#333' }}>{description}</Text>

      <View style={{ borderTopWidth: 1, borderColor: '#eee', paddingTop: 14, gap: 6 }}>
        {partnerNames.length ? (
          <Text style={{ color: '#555' }}>Doing this with {partnerNames.join(' & ')}</Text>
        ) : null}
        <Text style={{ color: '#555' }}>Cost: {COST_TIER_LABEL[row.missions.cost_tier]}</Text>
        <Text style={{ color: '#555' }}>Reward: {row.missions.points} points, {row.missions.coins} coins</Text>
        {row.missions.requires_game ? (
          <Text style={{ color: '#555' }}>Needs: {row.missions.requires_game}</Text>
        ) : null}
        {goesOut ? (
          <Text style={{ color: '#555' }}>This one is outside the house</Text>
        ) : null}
      </View>

      {alreadySubmitted ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: '#b8860b' }}>
            Photo submitted. Waiting on verification.
          </Text>
          <Button
            title="Stuck? Ask for a hint"
            color="#2563eb"
            onPress={() => navigation.navigate('MissionHintChat', { assignmentId: row.id })}
          />
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Button
            title="Take proof photo"
            onPress={() => navigation.navigate('MissionPhotoCapture', { assignmentId: row.id })}
          />
          <Button
            title="Stuck? Ask for a hint"
            color="#2563eb"
            onPress={() => navigation.navigate('MissionHintChat', { assignmentId: row.id })}
          />
          {goesOut ? (
            <Button
              title="Places near me"
              color="#2563eb"
              onPress={() => navigation.navigate('NearbyLocations')}
            />
          ) : null}
          <Button
            title={busy ? 'Skipping...' : 'Skip this one'}
            onPress={handleSkip}
            disabled={busy}
            color="#999"
          />
        </View>
      )}
    </ScrollView>
  );
}