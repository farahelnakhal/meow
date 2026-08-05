import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_PROFILE_KEY = 'active_family_member_id';

export async function setActiveProfile(memberId: string) {
  await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, memberId);
}

export async function getActiveProfile(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
}

export async function clearActiveProfile() {
  await AsyncStorage.removeItem(ACTIVE_PROFILE_KEY);
}