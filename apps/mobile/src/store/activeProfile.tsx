import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ACTIVE_PROFILE_KEY = 'active_family_member_id';

export async function readActiveProfile(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
}

async function writeActiveProfile(memberId: string) {
  await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, memberId);
}

async function removeActiveProfile() {
  await AsyncStorage.removeItem(ACTIVE_PROFILE_KEY);
}

type Ctx = {
  activeProfileId: string | null;
  loading: boolean;
  selectProfile: (memberId: string) => Promise<void>;
  clearProfile: () => Promise<void>;
};

const ActiveProfileContext = createContext<Ctx | null>(null);

//active profile lives in React state, not in a module level listener set
export function ActiveProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setActiveProfileId(await readActiveProfile());
      } catch (e: any) {
        console.log('[profile] initial read failed:', e?.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectProfile = useCallback(async (memberId: string) => {
    try {
      await writeActiveProfile(memberId);
      setActiveProfileId(memberId);
      console.log('[profile] selected', memberId);
    } catch (e: any) {
      console.log('[profile] select failed:', e?.message);
      throw e;
    }
  }, []);

  const clearProfile = useCallback(async () => {
    try {
      await removeActiveProfile();
    } finally {
      setActiveProfileId(null);
    }
  }, []);

  return (
    <ActiveProfileContext.Provider value={{ activeProfileId, loading, selectProfile, clearProfile }}>
      {children}
    </ActiveProfileContext.Provider>
  );
}

export function useActiveProfile() {
  const ctx = useContext(ActiveProfileContext);
  if (!ctx) throw new Error('useActiveProfile must be used inside ActiveProfileProvider');
  return ctx;
}