import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabaseClient';
import CreateFamilyAccount from '../screens/onboarding/CreateFamilyAccount';
import SignIn from '../screens/onboarding/SignIn';
import AddFamilyMembers from '../screens/onboarding/AddFamilyMembers';
import MemberInterestQuiz from '../screens/onboarding/MemberInterestQuiz';
import CaregiverSurvey from '../screens/onboarding/CaregiverSurvey';
import ProfileSwitcher from '../screens/onboarding/ProfileSwitcher';
import MissionFeed from '../screens/missions/MissionFeed';
import MissionDetail from '../screens/missions/MissionDetail';
import MissionPhotoCapture from '../screens/missions/MissionPhotoCapture';
import MissionRating from '../screens/missions/MissionRating';
import EggOpening from '../screens/rewards/EggOpening';
import AnimalCollection from '../screens/rewards/AnimalCollection';
import SettlementBuilder from '../screens/rewards/SettlementBuilder';
import { useActiveProfile } from '../store/activeProfile';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { activeProfileId, loading: profileLoading, clearProfile } = useActiveProfile();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();

        // getSession() only reads AsyncStorage and never checks server
        if (data.session) {
          const { data: userData, error } = await supabase.auth.getUser();
          if (error || !userData?.user) {
            console.log('[Root] stale session discarded:', error?.message);
            await supabase.auth.signOut();
            await clearProfile();
            setSession(null);
            return;
          }
        }

        setSession(data.session);
      } catch (e: any) {
        console.log('[Root] init failed:', e?.message);
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => listener.subscription.unsubscribe();
  }, [clearProfile]);

  if (loading || profileLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>root: checking session</Text>
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
            {/* setup order: members -> interests (everyone) -> caregiver survey (last) */}
            <Stack.Screen name="AddFamilyMembers" component={AddFamilyMembers} />
            <Stack.Screen name="MemberInterestQuiz" component={MemberInterestQuiz} />
            <Stack.Screen name="CaregiverSurvey" component={CaregiverSurvey} />
            <Stack.Screen name="ProfileSwitcher" component={ProfileSwitcher} />
          </>
        ) : (
          <>
            <Stack.Screen name="MissionFeed" component={MissionFeed} />
            <Stack.Screen name="MissionDetail" component={MissionDetail} />
            <Stack.Screen name="MissionPhotoCapture" component={MissionPhotoCapture} />
            <Stack.Screen name="MissionRating" component={MissionRating} />
            <Stack.Screen name="EggOpening" component={EggOpening} />
            <Stack.Screen name="AnimalCollection" component={AnimalCollection} />
            <Stack.Screen name="SettlementBuilder" component={SettlementBuilder} />
            <Stack.Screen name="ProfileSwitcher" component={ProfileSwitcher} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}