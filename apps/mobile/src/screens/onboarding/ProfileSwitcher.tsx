import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { setActiveProfile } from '../../store/activeProfile';

type Member = { id: string; display_name: string; role: string };

export default function ProfileSwitcher() {
  const navigation = useNavigation<any>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMembers = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      // find the parent's own member row to get family_id
      const { data: parentRow } = await supabase
        .from('family_members')
        .select('family_id')
        .eq('auth_user_id', userData.user.id)
        .single();

      if (!parentRow) return;

      const { data: allMembers } = await supabase
        .from('family_members')
        .select('id, display_name, role')
        .eq('family_id', parentRow.family_id);

      setMembers(allMembers ?? []);
      setLoading(false);
    };
    loadMembers();
  }, []);

  const selectProfile = async (memberId: string) => {
    await setActiveProfile(memberId);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  if (loading) return null;

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Who's using the app?</Text>
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => selectProfile(item.id)}
            style={{ padding: 16, borderWidth: 1, marginBottom: 10, borderRadius: 8 }}
          >
            <Text style={{ fontSize: 18 }}>{item.display_name} ({item.role})</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}