import React, { useCallback, useState } from 'react';
import { View, Text, Button, Alert, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getMyFamilyId } from '../../services/api/missions';
import { getBalances, ensureEgg, getIncubatingEgg, contributePoints, hatchEgg } from '../../services/api/economy';
import {
  eggProgressPct, ANIMAL_GLYPH, RARITY_LABEL, RARITY_COLOR,
  type Balances, type EggRow, type HatchResult,
} from '../../types/economy';

export default function EggOpening() {
  const navigation = useNavigation<any>();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [egg, setEgg] = useState<EggRow | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hatched, setHatched] = useState<HatchResult | null>(null);

  const load = useCallback(async () => {
    try {
      const { familyId: fid, error: famErr } = await getMyFamilyId();
      if (!fid) return setError(famErr ?? 'No family found.');
      setFamilyId(fid);

      // idempotent: creates the egg only if the family has none incubating
      const { error: ensureErr } = await ensureEgg(fid);
      if (ensureErr) return setError(ensureErr);

      const [{ data: e, error: eErr }, { data: b, error: bErr }] = await Promise.all([
        getIncubatingEgg(fid),
        getBalances(fid),
      ]);
      if (eErr) return setError(eErr);
      if (bErr) return setError(bErr);

      setEgg(e);
      setBalances(b);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load the egg.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const contribute = async (amount: number) => {
    if (!familyId) return;
    setBusy(true);
    const { data, error: err } = await contributePoints(familyId, amount);
    setBusy(false);
    if (err) {
      Alert.alert('Could not add points', err);
      return;
    }
    if (data) {
      setEgg((prev) => (prev ? { ...prev, points_contributed: data.points_contributed } : prev));
      setBalances((prev) => (prev ? { ...prev, points_balance: data.points_balance } : prev));
    }
  };

  const doHatch = async () => {
    if (!familyId) return;
    setBusy(true);
    const { data, error: err } = await hatchEgg(familyId);
    setBusy(false);
    if (err) {
      Alert.alert('Could not hatch', err);
      return;
    }
    setHatched(data);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>egg: loading</Text>
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

  if (hatched) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14 }}>
        <Text style={{ fontSize: 96 }}>{ANIMAL_GLYPH[hatched.image_key] ?? '🥚'}</Text>
        <Text style={{ fontSize: 26, fontWeight: 'bold', textAlign: 'center' }}>{hatched.common_name}</Text>
        <Text style={{ color: RARITY_COLOR[hatched.rarity], fontWeight: '600' }}>
          {RARITY_LABEL[hatched.rarity]}
        </Text>
        <Text style={{ color: '#555', textAlign: 'center' }}>Lives in {hatched.habitat}</Text>
        <Text style={{ color: '#333', textAlign: 'center', lineHeight: 21, marginTop: 6 }}>
          {hatched.fun_fact}
        </Text>
        <View style={{ gap: 10, marginTop: 16, alignSelf: 'stretch' }}>
          <Button title="See the collection" onPress={() => navigation.navigate('AnimalCollection')} />
          <Button title="Back to missions" color="#777" onPress={() => navigation.navigate('MissionFeed')} />
        </View>
      </View>
    );
  }

  const pct = eggProgressPct(egg);
  const remaining = egg ? Math.max(0, egg.points_required - egg.points_contributed) : 0;
  const available = balances?.points_balance ?? 0;
  const ready = remaining === 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 18, alignItems: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Your egg</Text>
      <Text style={{ fontSize: 84 }}>🥚</Text>

      <View style={{ alignSelf: 'stretch', gap: 6 }}>
        <View style={{ height: 14, backgroundColor: '#eee', borderRadius: 7, overflow: 'hidden' }}>
          <View style={{ height: 14, width: `${pct}%`, backgroundColor: '#2563eb' }} />
        </View>
        <Text style={{ textAlign: 'center', color: '#555' }}>
          {egg?.points_contributed ?? 0} / {egg?.points_required ?? 0} points ({pct}%)
        </Text>
      </View>

      <Text style={{ color: '#555' }}>You have {available} points to spend</Text>

      {ready ? (
        busy ? <ActivityIndicator /> : (
          <View style={{ alignSelf: 'stretch' }}>
            <Button title="Hatch it" onPress={doHatch} />
          </View>
        )
      ) : (
        <View style={{ alignSelf: 'stretch', gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
            {[10, 25, 50].map((n) => (
              <TouchableOpacity
                key={n}
                disabled={busy || available < Math.min(n, remaining)}
                onPress={() => contribute(n)}
                style={{
                  borderWidth: 1, borderColor: '#333', borderRadius: 20,
                  paddingVertical: 10, paddingHorizontal: 18,
                  opacity: available < Math.min(n, remaining) ? 0.3 : 1,
                }}
              >
                <Text>+{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button
            title={`Add everything (${Math.min(available, remaining)})`}
            onPress={() => contribute(Math.min(available, remaining))}
            disabled={busy || available === 0}
          />
          {busy ? <ActivityIndicator /> : null}
          <Text style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>
            {remaining} more points to hatch
          </Text>
        </View>
      )}

      <Button title="View collection" color="#777" onPress={() => navigation.navigate('AnimalCollection')} />
    </ScrollView>
  );
}