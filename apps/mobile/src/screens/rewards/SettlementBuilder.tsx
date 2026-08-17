import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, Alert, Button, ScrollView, Dimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getMyFamilyId } from '../../services/api/missions';
import {
  getAvailableBuildings, getPlacedBuildings, purchaseBuilding, getBalances,
} from '../../services/api/economy';
import {
  GRID_SIZE, BUILDING_GLYPH,
  type AvailableBuilding, type PlacedBuilding, type Balances,
} from '../../types/economy';

export default function SettlementBuilder() {
  const navigation = useNavigation<any>();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedBuilding[]>([]);
  const [available, setAvailable] = useState<AvailableBuilding[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<AvailableBuilding | null>(null);

  const load = useCallback(async () => {
    try {
      const { familyId: fid, error: famErr } = await getMyFamilyId();
      if (!fid) return setError(famErr ?? 'No family found.');
      setFamilyId(fid);

      const [p, a, b] = await Promise.all([
        getPlacedBuildings(fid),
        getAvailableBuildings(fid),
        getBalances(fid),
      ]);
      if (p.error) return setError(p.error);
      if (a.error) return setError(a.error);

      setPlaced(p.data);
      setAvailable(a.data);
      setBalances(b.data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load the settlement.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const occupant = (x: number, y: number) =>
    placed.find((b) => b.grid_x === x && b.grid_y === y) ?? null;

  const tapCell = async (x: number, y: number) => {
    const existing = occupant(x, y);
    if (existing) {
      const meta = available.find((a) => a.key === existing.building_key);
      Alert.alert(meta?.label ?? existing.building_key, meta?.description ?? 'Already built here.');
      return;
    }
    if (!selected) {
      Alert.alert('Pick a building', 'Choose something from the list below, then tap an empty square.');
      return;
    }
    if (!familyId) return;

    setBusy(true);
    const { data, error: err } = await purchaseBuilding(familyId, selected.key, x, y);
    setBusy(false);

    if (err) {
      Alert.alert('Could not build', err);
      return;
    }
    if (data) {
      setBalances((prev) => (prev ? { ...prev, coins_balance: data.coins_balance } : prev));
      setSelected(null);
      await load();
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>settlement: loading</Text>
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

  const width = Dimensions.get('window').width;
  const cell = Math.floor((width - 40 - (GRID_SIZE - 1) * 4) / GRID_SIZE);
  const coins = balances?.coins_balance ?? 0;
  const buildable = available.filter((a) => !a.already_built);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 16 }}>
      <View>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Your settlement</Text>
        <Text style={{ color: '#666', marginTop: 4 }}>
          {placed.length} of {available.length} built · {coins} coins
        </Text>
      </View>

      <View style={{ gap: 4 }}>
        {Array.from({ length: GRID_SIZE }).map((_, y) => (
          <View key={y} style={{ flexDirection: 'row', gap: 4 }}>
            {Array.from({ length: GRID_SIZE }).map((__, x) => {
              const b = occupant(x, y);
              const isTarget = !b && selected !== null;
              return (
                <TouchableOpacity
                  key={x}
                  onPress={() => tapCell(x, y)}
                  disabled={busy}
                  style={{
                    width: cell, height: cell, borderRadius: 6,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: b ? '#e8f0e8' : isTarget ? '#eef4ff' : '#f5f5f5',
                    borderWidth: isTarget ? 2 : 1,
                    borderStyle: isTarget ? 'dashed' : 'solid',
                    borderColor: isTarget ? '#2563eb' : '#e0e0e0',
                  }}
                >
                  <Text style={{ fontSize: Math.floor(cell * 0.5) }}>
                    {b ? BUILDING_GLYPH[b.building_key] ?? '🏠' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {selected ? (
        <View style={{ backgroundColor: '#eef4ff', borderRadius: 8, padding: 12, gap: 4 }}>
          <Text style={{ fontWeight: '600' }}>Placing: {selected.label}</Text>
          <Text style={{ fontSize: 12, color: '#555' }}>Tap an empty square above.</Text>
          <Button title="Cancel" color="#777" onPress={() => setSelected(null)} />
        </View>
      ) : null}

      {busy ? <ActivityIndicator /> : null}

      <Text style={{ fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>Build next</Text>

      {buildable.length === 0 ? (
        <Text style={{ color: '#666' }}>Everything is built. Nicely done.</Text>
      ) : (
        buildable.map((a) => {
          const affordable = coins >= a.coin_cost;
          const canBuild = a.unlocked && affordable;
          return (
            <TouchableOpacity
              key={a.key}
              disabled={!canBuild || busy}
              onPress={() => setSelected(a)}
              style={{
                borderWidth: 1, borderRadius: 10, padding: 14, gap: 4,
                borderColor: selected?.key === a.key ? '#2563eb' : '#ddd',
                opacity: canBuild ? 1 : 0.45,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 26 }}>{BUILDING_GLYPH[a.image_key] ?? '🏠'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600' }}>{a.label}</Text>
                  <Text style={{ fontSize: 12, color: '#777' }}>{a.coin_cost} coins</Text>
                </View>
              </View>
              <Text style={{ color: '#444', lineHeight: 19 }}>{a.description}</Text>
              {!a.unlocked ? (
                <Text style={{ fontSize: 12, color: '#b45309' }}>Locked — build the previous one first</Text>
              ) : !affordable ? (
                <Text style={{ fontSize: 12, color: '#b45309' }}>
                  Need {a.coin_cost - coins} more coins
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })
      )}

      <Button title="Back to missions" color="#777" onPress={() => navigation.navigate('MissionFeed')} />
    </ScrollView>
  );
}