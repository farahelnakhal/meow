import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, FlatList, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';

type Member = { display_name: string; role: 'child' | 'caregiver'; birth_year?: string };

export default function AddFamilyMembers() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [familyId, setFamilyId] = useState<string | null>(route.params?.familyId ?? null);

  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [role, setRole] = useState<'child' | 'caregiver'>('child');
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (familyId) return; // already have it from navigation params

    const loadFamilyId = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data: memberRow, error } = await supabase
        .from('family_members')
        .select('family_id')
        .eq('auth_user_id', userData.user.id)
        .single();

      if (error) {
        console.log('lookup error:', error.message);
        return;
      }

      if (memberRow) setFamilyId(memberRow.family_id);
    };
    loadFamilyId();
  }, [familyId]);

  const addToList = () => {
    if (!name.trim()) return;
    setMembers([...members, { display_name: name, role, birth_year: birthYear }]);
    setName('');
    setBirthYear('');
  };

  const handleFinish = async () => {
    if (!familyId) return;
    setSaving(true);
    const rows = members.map((m) => ({
      family_id: familyId,
      display_name: m.display_name,
      role: m.role,
      birth_year: m.birth_year ? parseInt(m.birth_year, 10) : null,
      auth_user_id: null, //kids dont get supabase auth acc
    }));

    if (rows.length > 0) {
      const { error } = await supabase.from('family_members').insert(rows);
      if (error) {
        Alert.alert('Error', error.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    navigation.navigate('ProfileSwitcher');
  };

  if (!familyId) return null; // loading state while we resolve family_id

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Add Family Members</Text>

      <TextInput placeholder="Name" value={name} onChangeText={setName} style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Birth year (optional)" value={birthYear} onChangeText={setBirthYear} keyboardType="numeric" style={{ borderWidth: 1, padding: 10 }} />

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Child" onPress={() => setRole('child')} color={role === 'child' ? 'blue' : 'gray'} />
        <Button title="Caregiver" onPress={() => setRole('caregiver')} color={role === 'caregiver' ? 'blue' : 'gray'} />
      </View>

      <Button title="Add to family" onPress={addToList} />

      <FlatList
        data={members}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => <Text>{item.display_name} — {item.role}</Text>}
      />

      <Button title={saving ? 'Saving...' : 'Finish Setup'} onPress={handleFinish} disabled={saving} />
    </View>
  );
}