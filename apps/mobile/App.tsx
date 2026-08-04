import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { supabase } from './src/services/supabaseClient';

export default function App() {
  const [status, setStatus] = useState('checking...');

  useEffect(() => {
    const checkConnection = async () => {
      const { error } = await supabase.from('families').select('id').limit(1);
      setStatus(error ? `error: ${error.message}` : 'connected ✅');
    };
    checkConnection();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Supabase status: {status}</Text>
    </View>
  );
}