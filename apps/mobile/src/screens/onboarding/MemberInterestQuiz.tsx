import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { generateFamilyProfile } from '../../services/api/profile';
import { InterestCategory, FamilyMemberRow, WEIGHT_LABELS } from '../../types/onboarding';

export default function MemberInterestQuiz() {
  const navigation = useNavigation<any>();
  const [categories, setCategories] = useState<InterestCategory[]>([]);
  const [members, setMembers] = useState<FamilyMemberRow[]>([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
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
        setFamilyId(me.family_id);

        const [catsRes, memsRes] = await Promise.all([
          supabase.from('interest_categories').select('key, label, sort_order').order('sort_order'),
          supabase
            .from('family_members')
            .select('id, display_name, role, birth_year')
            .eq('family_id', me.family_id)
            .order('created_at'),
        ]);

        if (catsRes.error) return setError(catsRes.error.message);
        if (memsRes.error) return setError(memsRes.error.message);

        setCategories(catsRes.data ?? []);
        setMembers(memsRes.data ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load quiz.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const current = members[index];

  const finishAll = async () => {
    if (!familyId) return;
    setSaving(true);
    const { error: fnError } = await generateFamilyProfile(familyId);
    setSaving(false);

    // profile generation is an enhancement, not a gate — never trap the user here
    if (fnError) console.log('profile generation failed:', fnError);
    navigation.navigate('ProfileSwitcher');
  };

  const handleNext = async () => {
    if (!current) return;
    setSaving(true);

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
      await finishAll();
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
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
                  style={{ flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: selected ? '#333' : 'transparent' }}
                >
                  <Text style={{ fontSize: 11, color: selected ? 'white' : 'black' }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {saving ? (
        <ActivityIndicator />
      ) : (
        <Button title={index + 1 < members.length ? 'Next person' : 'Finish setup'} onPress={handleNext} />
      )}
    </ScrollView>
  );
}