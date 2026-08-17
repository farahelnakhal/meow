import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, Button, TextInput, Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getMyFamilyId } from '../../services/api/missions';
import { getFamilyAnimals, feedAnimal, renameAnimal, getBalances } from '../../services/api/economy';
import {
  ANIMAL_GLYPH, RARITY_LABEL, RARITY_COLOR, fedToday,
  type FamilyAnimal, type Balances,
} from '../../types/economy';

export default function AnimalCollection() {
  const navigation = useNavigation<any>();
  const [animals, setAnimals] = useState<FamilyAnimal[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FamilyAnimal | null>(null);
  const [draftName, setDraftName] = useState('');

  const load = useCallback(async () => {
    try {
      const { familyId, error: famErr } = await getMyFamilyId();
      if (!familyId) return setError(famErr ?? 'No family found.');

      const [{ data, error: aErr }, { data: b }] = await Promise.all([
        getFamilyAnimals(familyId),
        getBalances(familyId),
      ]);
      if (aErr) return setError(aErr);
      setAnimals(data);
      setBalances(b);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load the collection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleFeed = async (a: FamilyAnimal) => {
    setBusyId(a.id);
    const { data, error: err } = await feedAnimal(a.id);
    setBusyId(null);
    if (err) {
      Alert.alert('Could not feed', err);
      return;
    }
    if (data) {
      setAnimals((prev) => prev.map((x) =>
        x.id === a.id ? { ...x, times_fed: data.times_fed, last_fed_at: new Date().toISOString() } : x
      ));
      setBalances((prev) => (prev ? { ...prev, coins_balance: data.coins_balance } : prev));
    }
  };

  const saveName = async () => {
    if (!editing) return;
    const target = editing;
    setEditing(null);
    const { error: err } = await renameAnimal(target.id, draftName);
    if (err) {
      Alert.alert('Could not rename', err);
      return;
    }
    setAnimals((prev) => prev.map((x) =>
      x.id === target.id ? { ...x, nickname: draftName.trim() || null } : x
    ));
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>collection: loading</Text>
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

  return (
    <View style={{ flex: 1, paddingTop: 56 }}>
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Your animals</Text>
        <Text style={{ color: '#666', marginTop: 4 }}>
          {animals.length} hatched · {balances?.coins_balance ?? 0} coins
        </Text>
      </View>

      <FlatList
        data={animals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 40 }}>
            <Text style={{ fontSize: 56 }}>🥚</Text>
            <Text style={{ color: '#666', textAlign: 'center' }}>
              No animals yet. Finish missions to fill your egg.
            </Text>
            <Button title="Go to the egg" onPress={() => navigation.navigate('EggOpening')} />
          </View>
        }
        renderItem={({ item }) => {
          const already = fedToday(item);
          return (
            <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 40 }}>{ANIMAL_GLYPH[item.animals.image_key] ?? '🐾'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 17, fontWeight: '600' }}>
                    {item.nickname || item.animals.common_name}
                  </Text>
                  {item.nickname ? (
                    <Text style={{ fontSize: 12, color: '#888' }}>{item.animals.common_name}</Text>
                  ) : null}
                  <Text style={{ fontSize: 12, color: RARITY_COLOR[item.animals.rarity], fontWeight: '600' }}>
                    {RARITY_LABEL[item.animals.rarity]} · fed {item.times_fed}x
                  </Text>
                </View>
              </View>

              <Text style={{ color: '#444', lineHeight: 19 }}>{item.animals.fun_fact}</Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={already ? 'Fed today' : busyId === item.id ? 'Feeding...' : 'Feed (5 coins)'}
                    onPress={() => handleFeed(item)}
                    disabled={already || busyId !== null}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Rename"
                    color="#777"
                    onPress={() => { setEditing(item); setDraftName(item.nickname ?? ''); }}
                  />
                </View>
              </View>
            </View>
          );
        }}
      />

      <View style={{ padding: 20 }}>
        <Button title="Back to the egg" color="#777" onPress={() => navigation.navigate('EggOpening')} />
      </View>

      <Modal visible={editing !== null} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 30 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, gap: 14 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Name your animal</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              maxLength={40}
              autoFocus
              placeholder={editing?.animals.common_name ?? ''}
              style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" color="#999" onPress={() => setEditing(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Save" onPress={saveName} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}