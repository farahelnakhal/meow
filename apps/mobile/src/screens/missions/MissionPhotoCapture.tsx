import React, { useState } from 'react';
import { View, Text, Button, Alert, Image, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { getMyFamilyId, submitMissionPhoto } from '../../services/api/missions';

type Verdict = {
  verified?: boolean;
  reason?: string;
  points?: number;
  coins?: number;
  duplicate?: boolean;
};

export default function MissionPhotoCapture() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const assignmentId: string | undefined = route.params?.assignmentId;

  const [uri, setUri] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [mime, setMime] = useState('image/jpeg');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        fromCamera
          ? 'Camera access is required to take proof photos.'
          : 'Photo library access is required.'
      );
      return;
    }

    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      base64: true,
      quality: 0.6, // keeps the payload small enough for a single invoke
      allowsEditing: false,
    };

    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

    if (res.canceled || !res.assets?.length) return;

    const asset = res.assets[0];
    if (!asset.base64) {
      Alert.alert('Error', 'Could not read the image data. Try again.');
      return;
    }
    setUri(asset.uri);
    setBase64(asset.base64);
    setMime(asset.mimeType ?? 'image/jpeg');
    setVerdict(null);
  };

  const submit = async () => {
    if (!assignmentId || !base64) return;
    setBusy(true);

    const { familyId, error: famErr } = await getMyFamilyId();
    if (!familyId) {
      setBusy(false);
      Alert.alert('Error', famErr ?? 'No family found.');
      return;
    }

    const { verdict: v, error } = await submitMissionPhoto(assignmentId, familyId, base64, mime);
    setBusy(false);

    if (error) {
      Alert.alert('Verification failed', error);
      return;
    }
    setVerdict(v as Verdict);
  };

  const retry = () => {
    setVerdict(null);
    setUri(null);
    setBase64(null);
  };

  if (busy) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <ActivityIndicator />
        <Text style={{ color: '#666' }}>Checking your photo</Text>
        <Text style={{ fontSize: 12, color: '#aaa' }}>capture: verifying</Text>
      </View>
    );
  }

  if (verdict) {
    const ok = verdict.verified === true;
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: 'bold' }}>
          {ok ? 'Mission complete' : verdict.duplicate ? 'Photo already used' : 'Not quite'}
        </Text>

        <Text style={{ fontSize: 15, lineHeight: 22, color: '#333' }}>
          {verdict.reason ?? (ok ? 'Nice work.' : 'Try taking the photo again.')}
        </Text>

        {ok ? (
          <Text style={{ fontSize: 16 }}>
            +{verdict.points ?? 0} points, +{verdict.coins ?? 0} coins
          </Text>
        ) : null}

        <View style={{ gap: 10, marginTop: 8 }}>
          {ok ? (
            <Button
              title="Rate this mission"
              onPress={() => navigation.navigate('MissionRating', { assignmentId })}
            />
          ) : (
            <Button title="Try another photo" onPress={retry} />
          )}
          <Button
            title="Back to missions"
            color="#777"
            onPress={() => navigation.navigate('MissionFeed')}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold' }}>Proof photo</Text>
      <Text style={{ color: '#555', lineHeight: 21 }}>
        Take a photo that clearly shows the mission was done.
      </Text>

      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: '#eee' }}
          resizeMode="cover"
        />
      ) : null}

      <View style={{ gap: 10 }}>
        <Button title={uri ? 'Retake photo' : 'Open camera'} onPress={() => pick(true)} />
        <Button title="Choose from library" onPress={() => pick(false)} color="#777" />
        {base64 ? <Button title="Submit for verification" onPress={submit} /> : null}
      </View>
    </ScrollView>
  );
}