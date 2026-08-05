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
    setLoading(true);
    const { data: authData, error: authError } = await signUpWithEmail(email, password);
    if (authError || !authData.user) {
      Alert.alert('Error', authError?.message ?? 'Signup failed');
      setLoading(false);
      return;
    }

    const { data: family, error: familyError } = await supabase
      .from('families')
      .insert({ name: familyName })
      .select()
      .single();

    if (familyError) {
      Alert.alert('Error', familyError.message);
      setLoading(false);
      return;
    }

    //parent gets a real auth-linked member row
    const { error: memberError } = await supabase.from('family_members').insert({
      family_id: family.id,
      auth_user_id: authData.user.id,
      display_name: parentName,
      role: 'parent',
    });

    setLoading(false);

    if (memberError) {
      Alert.alert('Error', memberError.message);
      return;
    }

    //move to adding kids/other members (pass family_id)
    navigation.navigate('AddFamilyMembers', { familyId: family.id });
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Create Your Family</Text>
      <TextInput placeholder="Family name" value={familyName} onChangeText={setFamilyName} style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Your name" value={parentName} onChangeText={setParentName} style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={{ borderWidth: 1, padding: 10 }} />
      <Button title={loading ? 'Creating...' : 'Create Family'} onPress={handleCreate} disabled={loading} />
      <Text onPress={() => navigation.navigate('SignIn')} style={{ color: 'blue', textAlign: 'center' }}>
        Already have a family? Sign in
      </Text>
    </View>
  );
}