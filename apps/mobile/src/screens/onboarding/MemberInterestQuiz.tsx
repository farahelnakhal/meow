import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { type InterestCategory, type FamilyMemberRow, WEIGHT_LABELS } from '../../types/onboarding';

export default function MemberInterestQuiz() {
  const navigation = useNavigation<any>();
  const [categories, setCategories] = useState<InterestCategory[]>([]);
  const [members, setMembers] = useState<FamilyMemberRow[]>([]);
  const [index, setIndex] = useState(0);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) return setError('No signed-in user.');

        const { data: me, error: meErr } = await supabase
          .from('family_members')
          .select('family_id')
          .eq('auth_user_id', userData.user.id)
          .maybeSingle();

        if (meErr || !me) return setError(meErr?.message ?? 'No family found.');

        const [catsRes, memsRes] = await Promise.all([
          supabase.from('interest_categories').select('key, label, sort_order').order('sort_order'),
          supabase.from('family_members')
            .select('id, display_name, role, birth_year')
            .eq('family_id', me.family_id).order('created_at'),
        ]);

        if (catsRes.error) return setError(catsRes.error.message);
        if (memsRes.error) return setError(memsRes.error.message);

        setCategories(catsRes.data ?? []);
        setMembers(memsRes.data ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load the quiz.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const current = members[index];

  const handleNext = async () => {
    if (!current) return;
    setSaving(true);

    //unrated categories default to 1 matching assignment functions coalesce(mi.weight, 1)
    const rows = categories.map((c) => ({
      member_id: current.id,
      category_key: c.key,
      weight: weights[c.key] ?? 1,
    }));

    const { error: upsertErr } = await supabase
      .from('member_interests')
      .upsert(rows, { onConflict: 'member_id,category_key' });

    setSaving(false);

    if (upsertErr) {
      Alert.alert('Error', upsertErr.message);
      return;
    }

    setWeights({});
    if (index + 1 < members.length) {
      setIndex(index + 1);
    } else {
      //caregiver survey runs last in setup
      navigation.navigate('CaregiverSurvey');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>quiz: loading categories</Text>
      </View>
    );
  }

  if (error || !current) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ textAlign: 'center' }}>{error ?? 'No family members found.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingTop: 60, paddingBottom: 40 }}>
      <View>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>What does {current.display_name} enjoy?</Text>
        <Text style={{ color: '#666', marginTop: 4 }}>Person {index + 1} of {members.length}</Text>
      </View>

      {categories.map((c) => (
        <View key={c.key} style={{ gap: 6 }}>
          <Text style={{ fontSize: 15 }}>{c.label}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {WEIGHT_LABELS.map((label, w) => {
              const selected = (weights[c.key] ?? 1) === w;
              return (
                <TouchableOpacity
                  key={w}
                  onPress={() => setWeights((prev) => ({ ...prev, [c.key]: w }))}
                  style={{
                    flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8,
                    alignItems: 'center',
                    borderColor: selected ? '#333' : '#ccc',
                    backgroundColor: selected ? '#333' : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 11, color: selected ? 'white' : 'black' }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {saving ? (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 12, color: '#999' }}>quiz: saving</Text>
        </View>
      ) : (
        <Button title={index + 1 < members.length ? 'Next person' : 'Continue'} onPress={handleNext} />
      )}
    </ScrollView>
  );
}