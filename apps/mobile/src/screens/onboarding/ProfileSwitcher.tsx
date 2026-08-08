import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabaseClient';
import { setActiveProfile } from '../../store/activeProfile';

type Member = { id: string; display_name: string; role: string };

export default function ProfileSwitcher() {
  const navigation = useNavigation<any>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMembers = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          setError('Not signed in.');
          return;
        }

        //find the parents own member row to get family_id
        const { data: parentRow, error: parentErr } = await supabase
          .from('family_members')
          .select('family_id')
          .eq('auth_user_id', userData.user.id)
          .maybeSingle();

        if (parentErr) {
          setError(parentErr.message);
          return;
        }
        if (!parentRow) {
          setError('No family found for this account.');
          return;
        }

        const { data: allMembers, error: membersErr } = await supabase
          .from('family_members')
          .select('id, display_name, role')
          .eq('family_id', parentRow.family_id);

        if (membersErr) {
          setError(membersErr.message);
          return;
        }

        setMembers(allMembers ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Something went wrong loading profiles.');
      } finally {
        setLoading(false);
      }
    };

    loadMembers();
  }, []);

  const selectProfile = async (memberId: string) => {
    await setActiveProfile(memberId);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }

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