import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_PROFILE_KEY = 'active_family_member_id';

type Listener = (memberId: string | null) => void;
const listeners = new Set<Listener>();

export function subscribeActiveProfile(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(memberId: string | null) {
  listeners.forEach((fn) => fn(memberId));
}

export async function setActiveProfile(memberId: string) {
  await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, memberId);
  notify(memberId);
}

export async function getActiveProfile(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
}

export async function clearActiveProfile() {
  await AsyncStorage.removeItem(ACTIVE_PROFILE_KEY);
  notify(null);
}