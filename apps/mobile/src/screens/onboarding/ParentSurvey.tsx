import React, { useState } from 'react';
import { View, Text, Button, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { LIKERT_QUESTIONS, LIKERT_LABELS, TIME_OPTIONS, TIME_QUESTION_KEY } from '../../types/onboarding';

export default function ParentSurvey() {
  const navigation = useNavigation<any>();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const total = LIKERT_QUESTIONS.length + 1;
  const answered = Object.keys(answers).length;

  const handleSubmit = async () => {
    if (answered < total) {
      Alert.alert('Almost there', `${total - answered} question(s) left.`);
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      Alert.alert('Error', 'No signed-in user.');
      setSaving(false);
      return;
    }

    const { data: me, error: meErr } = await supabase
      .from('family_members')
      .select('id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (meErr || !me) {
      Alert.alert('Error', meErr?.message ?? 'Could not find your member record.');
      setSaving(false);
      return;
    }

    const rows = Object.entries(answers).map(([question_key, answer_value]) => ({
      member_id: me.id,
      question_key,
      answer_value,
    }));

    const { error } = await supabase
      .from('parent_survey_responses')
      .upsert(rows, { onConflict: 'member_id,question_key' });

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    navigation.navigate('MemberInterestQuiz');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingTop: 60, paddingBottom: 40 }}>
      <View>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>A few questions</Text>
        <Text style={{ color: '#666', marginTop: 4 }}>
          This helps us pick missions that fit your family. {answered}/{total} answered.
        </Text>
      </View>

      {LIKERT_QUESTIONS.map((q, i) => (
        <View key={q.key} style={{ gap: 8 }}>
          <Text style={{ fontSize: 15 }}>{i + 1}. {q.prompt}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {LIKERT_LABELS.map((label, idx) => {
              const value = idx + 1;
              const selected = answers[q.key] === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setAnswers((a) => ({ ...a, [q.key]: value }))}
                  style={{ flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: selected ? '#333' : 'transparent' }}
                >
                  <Text style={{ fontSize: 10, color: selected ? 'white' : 'black' }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 15 }}>
          {LIKERT_QUESTIONS.length + 1}. How much time can your family usually spend together on a weekday evening?
        </Text>
        {TIME_OPTIONS.map((opt) => {
          const selected = answers[TIME_QUESTION_KEY] === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setAnswers((a) => ({ ...a, [TIME_QUESTION_KEY]: opt.value }))}
              style={{ borderWidth: 1, borderRadius: 8, padding: 12, backgroundColor: selected ? '#333' : 'transparent' }}
            >
              <Text style={{ color: selected ? 'white' : 'black' }}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {saving ? <ActivityIndicator /> : <Button title="Continue" onPress={handleSubmit} />}
    </ScrollView>
  );
}