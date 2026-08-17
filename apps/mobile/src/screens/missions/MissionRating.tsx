import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, Alert, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { readActiveProfile } from '../../store/activeProfile';
import { getMyFamilyId } from '../../services/api/missions';
import { rateMission, getRating } from '../../services/api/economy';

export default function MissionRating() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const assignmentId: string | undefined = route.params?.assignmentId;

  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!assignmentId) return;
        const { data } = await getRating(assignmentId);
        if (data) {
          setStars(data.stars);
          setNote(data.note ?? '');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [assignmentId]);

  const submit = async () => {
    if (!assignmentId) return;
    if (stars < 1) {
      Alert.alert('Pick a rating', 'Tap a star from 1 to 5.');
      return;
    }

    setSaving(true);
    const memberId = await readActiveProfile();
    const { familyId, error: famErr } = await getMyFamilyId();

    if (!familyId || !memberId) {
      setSaving(false);
      Alert.alert('Error', famErr ?? 'No active profile.');
      return;
    }

    const { error } = await rateMission(assignmentId, familyId, memberId, stars, note);
    setSaving(false);

    if (error) {
      Alert.alert('Could not save rating', error);
      return;
    }
    navigation.navigate('MissionFeed');
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>rating: loading</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 18 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>How was it?</Text>
      <Text style={{ color: '#555', lineHeight: 21 }}>
        Your answer helps us pick better missions next time. It doesn't change your points.
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginVertical: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setStars(n)} hitSlop={8}>
            <Text style={{ fontSize: 40, opacity: n <= stars ? 1 : 0.25 }}>★</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        placeholder="Anything you want to add? (optional)"
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={500}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, minHeight: 90, textAlignVertical: 'top' }}
      />

      {saving ? (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 12, color: '#999' }}>rating: saving</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Button title="Save" onPress={submit} />
          <Button title="Skip" color="#999" onPress={() => navigation.navigate('MissionFeed')} />
        </View>
      )}
    </ScrollView>
  );
}