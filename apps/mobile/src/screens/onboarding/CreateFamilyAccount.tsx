import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase, signUpWithEmail } from '../../services/supabaseClient';

export default function CreateFamilyAccount() {
  const navigation = useNavigation<any>();
  const [familyName, setFamilyName] = useState('');
  const [parentName, setParentName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!familyName.trim() || !parentName.trim()) {
      Alert.alert('Missing info', 'Family name and your name are both required.');
      return;
    }

    setLoading(true);

    const { data: authData, error: authError } = await signUpWithEmail(email, password);

    if (authError || !authData.session) {
      Alert.alert(
        'Error',
        authError?.message ?? 'Signup returned no session'
      );
      setLoading(false);
      return;
    }

    // single atomic call: creates families row + parents family_members row
    const { data: familyId, error: rpcError } = await supabase.rpc('create_family_with_parent', {
      p_family_name: familyName,
      p_parent_name: parentName,
    });

    setLoading(false);

    if (rpcError || !familyId) {
      Alert.alert('Error', rpcError?.message ?? 'Family creation returned nothing.');
      return;
    }

    navigation.navigate('AddFamilyMembers', { familyId });
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Create Your Family</Text>
      <TextInput placeholder="Family name" value={familyName} onChangeText={setFamilyName} style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Your name" value={parentName} onChangeText={setParentName} style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={{ borderWidth: 1, padding: 10 }} />
      <Button title={loading ? 'Creating...' : 'Create Family'} onPress={handleCreate} disabled={loading} />
      <Text onPress={() => navigation.navigate('SignIn')} style={{ color: 'blue', textAlign: 'center' }}>
        Already have a family? Sign in
      </Text>
    </View>
  );
}