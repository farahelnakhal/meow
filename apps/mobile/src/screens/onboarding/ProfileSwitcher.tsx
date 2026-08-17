import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../../services/supabaseClient';
import { useActiveProfile } from '../../store/activeProfile';

type Member = { id: string; display_name: string; role: string };

export default function ProfileSwitcher() {
  const { selectProfile } = useActiveProfile();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const loadMembers = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) {
          setError('Not signed in.');
          return;
        }

        const { data: me, error: meErr } = await supabase
          .from('family_members')
          .select('family_id')
          .eq('auth_user_id', userData.user.id)
          .maybeSingle();

        if (meErr) return setError(meErr.message);
        if (!me) return setError('No family found for this account.');

        const { data: all, error: allErr } = await supabase
          .from('family_members')
          .select('id, display_name, role')
          .eq('family_id', me.family_id)
          .order('created_at');

        if (allErr) return setError(allErr.message);
        setMembers(all ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Something went wrong loading profiles.');
      } finally {
        //original early returns skipped this and stranded spinner
        setLoading(false);
      }
    };
    loadMembers();
  }, []);

  const handlePick = async (memberId: string) => {
    setBusyId(memberId);
    try {
      //no navigation, RootNavigator renders conditionally on activeProfileId
      await selectProfile(memberId);
    } catch (e: any) {
      Alert.alert('Could not switch profile', e?.message ?? 'Try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>switcher: loading profiles</Text>
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
    <View style={{ flex: 1, padding: 20, paddingTop: 60, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Who's using the app?</Text>
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handlePick(item.id)}
            disabled={busyId !== null}
            style={{
              padding: 16, borderWidth: 1, borderColor: '#ccc', marginBottom: 10,
              borderRadius: 8, opacity: busyId && busyId !== item.id ? 0.4 : 1,
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 18 }}>{item.display_name} ({item.role})</Text>
            {busyId === item.id ? <ActivityIndicator /> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}