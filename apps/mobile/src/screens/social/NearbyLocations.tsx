import React, { useState } from 'react';
import { View, Text, Button, ActivityIndicator, FlatList, Alert, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { readActiveProfile } from '../../store/activeProfile';
import { findNearby } from '../../services/api/social';
import { formatDistance, formatKind, type NearbyPlace } from '../../types/social';

export default function NearbyLocations() {
  const navigation = useNavigation<any>();
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);

    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError('Location access is needed to find places near you.');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const memberId = await readActiveProfile();
      const { data, error: nErr } = await findNearby(
        memberId,
        pos.coords.latitude,
        pos.coords.longitude
      );

      if (nErr) {
        setError(nErr);
        return;
      }
      setPlaces(data?.places ?? []);
      setRadius(data?.radius_meters ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not get your location.');
    } finally {
      setBusy(false);
    }
  };

  const openInMaps = (p: NearbyPlace) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open maps'));
  };

  return (
    <View style={{ flex: 1, paddingTop: 56 }}>
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <Text style={{ fontSize: 22, fontWeight: 'bold' }}>Places near you</Text>
        <Text style={{ color: '#666', marginTop: 4, lineHeight: 20 }}>
          {radius !== null
            ? `Within ${radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}, picked from what you like.`
            : 'We only look inside the limit your family set.'}
        </Text>
      </View>

      {busy ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 12, color: '#999' }}>nearby: searching</Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 }}>
          <Text style={{ textAlign: 'center' }}>{error}</Text>
          <Button title="Try again" onPress={search} />
        </View>
      ) : places === null ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 14 }}>
          <Text style={{ color: '#555', textAlign: 'center', lineHeight: 21 }}>
            Tap below and we'll find two or three places nearby that fit this mission.
          </Text>
          <Button title="Find places near me" onPress={search} />
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={(p, i) => `${p.name}-${i}`}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', gap: 12, paddingVertical: 30 }}>
              <Text style={{ color: '#666', textAlign: 'center', lineHeight: 21 }}>
                Nothing found inside your family's travel limit. A grown-up can raise it in settings.
              </Text>
              <Button title="Search again" onPress={search} />
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
              <Text style={{ fontSize: 12, color: '#777' }}>
                {formatKind(item.kind)} · {formatDistance(item.distance_m)}
              </Text>
              <Button title="Open in maps" onPress={() => openInMaps(item)} />
            </View>
          )}
        />
      )}

      <View style={{ padding: 20 }}>
        <Button title="Back" color="#777" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}