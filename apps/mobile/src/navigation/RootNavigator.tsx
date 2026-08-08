import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabaseClient';
import CreateFamilyAccount from '../screens/onboarding/CreateFamilyAccount';
import SignIn from '../screens/onboarding/SignIn';
import AddFamilyMembers from '../screens/onboarding/AddFamilyMembers';
import ProfileSwitcher from '../screens/onboarding/ProfileSwitcher';
import { getActiveProfile, clearActiveProfile } from '../store/activeProfile';

const Stack = createNativeStackNavigator();

function HomePlaceholder() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Logged in!</Text>
    </View>
  );
}

export default function RootNavigator() {
  const [session, setSession] = useState<any>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        const { data: userData, error } = await supabase.auth.getUser();
        if (error || !userData?.user) {
          console.log('[Root] stale session discarded:', error?.message);
          await supabase.auth.signOut();
          await clearActiveProfile();
          setSession(null);
          setActiveProfileId(null);
          setLoading(false);
          return;
        }
      }

      setSession(data.session);
      setActiveProfileId(await getActiveProfile());
      setLoading(false);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setActiveProfileId(await getActiveProfile());
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <>
            <Stack.Screen name="CreateFamilyAccount" component={CreateFamilyAccount} />
            <Stack.Screen name="SignIn" component={SignIn} />
          </>
        ) : !activeProfileId ? (
          <>
            <Stack.Screen name="AddFamilyMembers" component={AddFamilyMembers} />
            <Stack.Screen name="ProfileSwitcher" component={ProfileSwitcher} />
          </>
        ) : (
          <Stack.Screen name="Home" component={HomePlaceholder} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}