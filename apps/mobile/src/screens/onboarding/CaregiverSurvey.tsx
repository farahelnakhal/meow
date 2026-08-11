import React, { useMemo, useState } from 'react';
import { View, Text, Button, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { generateFamilyProfile } from '../../services/api/profile';
import { getMyFamilyId, assignMissions } from '../../services/api/missions';
import {
  CAREGIVER_SURVEY, CAREGIVER_SURVEY_INTRO, shuffled, type OptionKey,
} from '../../types/onboarding';

export default function CaregiverSurvey() {
  const navigation = useNavigation<any>();
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  //randomised once per mount per spec
  const questions = useMemo(
    () => shuffled(CAREGIVER_SURVEY).map((q) => ({ ...q, options: shuffled(q.options) })),
    []
  );

  const answered = Object.keys(answers).length;
  const total = questions.length;

  const handleSubmit = async () => {
    if (answered < total) {
      Alert.alert('Almost there', `${total - answered} scenario(s) left.`);
      return;
    }

    setSaving(true);
    setProgress('Saving your answers');

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

    //raw question responses are stored for later psychometric analysis
    const rows = questions
      .filter((q) => answers[q.key])
      .map((q) => ({
        member_id: me.id,
        question_key: q.key,
        answer_text: answers[q.key],
        answer_value: q.scores[answers[q.key]],
      }));

    const { error } = await supabase
      .from('parent_survey_responses')
      .upsert(rows, { onConflict: 'member_id,question_key' });

    if (error) {
      Alert.alert('Error', error.message);
      setSaving(false);
      return;
    }

    //profile generation derives skill_focus serverside from these rows and writes it to private table
    setProgress('Building your family profile');
    const { familyId } = await getMyFamilyId();

    if (familyId) {
      const { error: fnError } = await generateFamilyProfile(familyId);
      if (fnError) console.log('profile generation failed:', fnError);

      setProgress('Picking your first missions');
      const { error: assignError } = await assignMissions(familyId, 3);
      if (assignError) console.log('assignment failed:', assignError);
    }

    setSaving(false);
    setProgress(null);
    navigation.navigate('ProfileSwitcher');
  };

  if (saving) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <ActivityIndicator />
        <Text style={{ color: '#666' }}>{progress ?? 'Working'}</Text>
        <Text style={{ fontSize: 12, color: '#aaa' }}>survey: finishing setup</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 24, paddingTop: 60, paddingBottom: 48 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>A few scenarios</Text>
        <Text style={{ color: '#444', lineHeight: 20 }}>{CAREGIVER_SURVEY_INTRO}</Text>
        <Text style={{ color: '#888', fontSize: 12 }}>{answered} of {total} answered</Text>
      </View>

      {questions.map((q, i) => (
        <View key={q.key} style={{ gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600' }}>{i + 1}. {q.scenario}</Text>
          {q.options.map((opt) => {
            const selected = answers[q.key] === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setAnswers((a) => ({ ...a, [q.key]: opt.key }))}
                style={{
                  borderWidth: 1, borderRadius: 8, padding: 12,
                  borderColor: selected ? '#333' : '#ccc',
                  backgroundColor: selected ? '#333' : 'transparent',
                }}
              >
                <Text style={{ color: selected ? 'white' : 'black', lineHeight: 19 }}>{opt.text}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <Button title="Finish setup" onPress={handleSubmit} />
    </ScrollView>
  );
}