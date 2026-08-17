import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase, signUpWithEmail } from '../../services/supabaseClient';

//must match missions.requires_game values exactly or filter silently
const GAME_OPTIONS = ['LEGO'];
const RADIUS_OPTIONS = [500, 1000, 2000, 5000];

export default function CreateFamilyAccount() {
  const navigation = useNavigation<any>();
  const [familyName, setFamilyName] = useState('');
  const [parentName, setParentName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [maxBudget, setMaxBudget] = useState('20');
  const [radius, setRadius] = useState(1000);
  const [games, setGames] = useState<string[]>([]);
  const [hasPets, setHasPets] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggleGame = (g: string) =>
    setGames((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const handleCreate = async () => {
    if (!familyName.trim() || !parentName.trim()) {
      Alert.alert('Missing info', 'Family name and your name are both required.');
      return;
    }

    const budget = parseFloat(maxBudget);
    if (isNaN(budget) || budget < 0) {
      Alert.alert('Invalid budget', 'Enter a number of 0 or more.');
      return;
    }

    setLoading(true);
    const { data: authData, error: authError } = await signUpWithEmail(email, password);

    // session, not just user:
    if (authError || !authData.session) {
      Alert.alert('Error', authError?.message ?? 'Signup returned no session. Check that email confirmation is off in Supabase.');
      setLoading(false);
      return;
    }

    const { data: familyId, error: rpcError } = await supabase.rpc('create_family_with_parent', {
      p_family_name: familyName,
      p_parent_name: parentName,
      p_max_budget: budget,
      p_geofence_radius_meters: radius,
      p_games_owned: games,
      p_has_pets: hasPets,
    });

    setLoading(false);

    if (rpcError || !familyId) {
      Alert.alert('Error', rpcError?.message ?? 'Family creation returned nothing.');
      return;
    }
  };

  const chip = (selected: boolean) => ({
    borderWidth: 1, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14,
    borderColor: selected ? '#333' : '#ccc',
    backgroundColor: selected ? '#333' : 'transparent',
  });

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingTop: 60, paddingBottom: 40 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Create Your Family</Text>

      <TextInput placeholder="Family name" value={familyName} onChangeText={setFamilyName} style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 }} />
      <TextInput placeholder="Your name" value={parentName} onChangeText={setParentName} style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 }} />
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 }} />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 }} />

      <Text style={{ fontWeight: 'bold', marginTop: 12 }}>Spending limit per mission</Text>
      <TextInput placeholder="0" value={maxBudget} onChangeText={setMaxBudget} keyboardType="numeric" style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 }} />
      <Text style={{ fontSize: 12, color: '#666' }}>
        Missions that cost more than this are never assigned. Set 0 for free missions only.
      </Text>

      <Text style={{ fontWeight: 'bold', marginTop: 12 }}>How far can members travel?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RADIUS_OPTIONS.map((r) => (
          <TouchableOpacity key={r} onPress={() => setRadius(r)} style={chip(radius === r)}>
            <Text style={{ color: radius === r ? 'white' : 'black' }}>
              {r >= 1000 ? `${r / 1000} km` : `${r} m`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ fontWeight: 'bold', marginTop: 12 }}>What do you already have at home?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GAME_OPTIONS.map((g) => (
          <TouchableOpacity key={g} onPress={() => toggleGame(g)} style={chip(games.includes(g))}>
            <Text style={{ color: games.includes(g) ? 'white' : 'black' }}>{g}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setHasPets(!hasPets)} style={chip(hasPets)}>
          <Text style={{ color: hasPets ? 'white' : 'black' }}>A pet</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: 20 }}>
        <Button title={loading ? 'Creating...' : 'Create Family'} onPress={handleCreate} disabled={loading} />
      </View>

      <Text onPress={() => navigation.navigate('SignIn')} style={{ color: 'blue', textAlign: 'center', marginTop: 8 }}>
        Already have a family? Sign in
      </Text>
    </ScrollView>
  );
}