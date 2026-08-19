import React, { useState } from 'react';
import {
  View, Text, TextInput, Button, ScrollView, ActivityIndicator, Alert, TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getMyFamilyId } from '../../services/api/missions';
import { suggestPollOptions, createPoll } from '../../services/api/social';

const OCCASIONS = ['this weekend', 'tonight', 'the school holidays'];
const MAX_OPTIONS = 6;

export default function CreatePoll() {
  const navigation = useNavigation<any>();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [details, setDetails] = useState<(string | null)[]>([null, null]);
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const setOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, '']);
    setDetails((prev) => [...prev, null]);
  };

  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
    setDetails((prev) => prev.filter((_, idx) => idx !== i));
  };

  const suggest = async () => {
    setSuggesting(true);
    const { data, error } = await suggestPollOptions(occasion);
    setSuggesting(false);

    if (error) {
      Alert.alert('No suggestions right now', `${error}\n\nYou can still write your own options.`);
      return;
    }
    if (!data) return;

    setQuestion(data.question);
    setOptions(data.options.map((o) => o.label));
    setDetails(data.options.map((o) => o.detail));
  };

  const save = async () => {
    const filled = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (question.trim().length < 3) {
      Alert.alert('Add a question', 'Say what the family is voting on.');
      return;
    }
    if (filled.length < 2) {
      Alert.alert('Add more options', 'A poll needs at least two options.');
      return;
    }

    //keep details aligned with options that survived filtering
    const keptDetails = options
      .map((o, i) => ({ o: o.trim(), d: details[i] ?? null }))
      .filter((x) => x.o.length > 0)
      .map((x) => x.d);

    setSaving(true);
    const { familyId, error: famErr } = await getMyFamilyId();
    if (!familyId) {
      setSaving(false);
      Alert.alert('Error', famErr ?? 'No family found.');
      return;
    }

    const { error } = await createPoll(familyId, question.trim(), filled, keptDetails);
    setSaving(false);

    if (error) {
      Alert.alert('Could not create the poll', error);
      return;
    }
    navigation.navigate('VotePoll');
  };

  if (saving) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>poll: saving</Text>
      </View>
    );
  }

  const chip = (selected: boolean) => ({
    borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12,
    borderColor: selected ? '#333' : '#ccc',
    backgroundColor: selected ? '#333' : 'transparent',
  });

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 14, paddingBottom: 40 }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold' }}>New family poll</Text>
      <Text style={{ color: '#666', lineHeight: 20 }}>
        Everyone in the family gets one vote. Creating a new poll closes the last one.
      </Text>

      <Text style={{ fontWeight: '600', marginTop: 6 }}>Get some ideas</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {OCCASIONS.map((o) => (
          <TouchableOpacity key={o} onPress={() => setOccasion(o)} style={chip(occasion === o)}>
            <Text style={{ color: occasion === o ? 'white' : 'black', fontSize: 13 }}>{o}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {suggesting ? (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 12, color: '#999' }}>poll: thinking of ideas</Text>
        </View>
      ) : (
        <Button title="Suggest options for me" onPress={suggest} />
      )}

      <Text style={{ fontWeight: '600', marginTop: 10 }}>Question</Text>
      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder="What should we do on Saturday?"
        maxLength={200}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />

      <Text style={{ fontWeight: '600', marginTop: 10 }}>Options</Text>
      {options.map((o, i) => (
        <View key={i} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={o}
              onChangeText={(v) => setOption(i, v)}
              placeholder={`Option ${i + 1}`}
              maxLength={120}
              style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
            />
            {options.length > 2 ? (
              <TouchableOpacity onPress={() => removeOption(i)} hitSlop={8}>
                <Text style={{ fontSize: 22, color: '#999' }}>×</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {details[i] ? (
            <Text style={{ fontSize: 12, color: '#888', paddingHorizontal: 4 }}>{details[i]}</Text>
          ) : null}
        </View>
      ))}

      {options.length < MAX_OPTIONS ? (
        <Button title="Add another option" color="#777" onPress={addOption} />
      ) : (
        <Text style={{ fontSize: 12, color: '#999' }}>Six options is the maximum.</Text>
      )}

      <View style={{ marginTop: 14, gap: 10 }}>
        <Button title="Start the poll" onPress={save} />
        <Button title="Cancel" color="#999" onPress={() => navigation.goBack()} />
      </View>
    </ScrollView>
  );
}