import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Button, FlatList, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { readActiveProfile } from '../../store/activeProfile';
import { getMyFamilyId } from '../../services/api/missions';
import { getHintHistory, getHintQuota, askHint } from '../../services/api/social';
import type { HintMessage } from '../../types/social';

export default function MissionHintChat() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const assignmentId: string | undefined = route.params?.assignmentId;

  const [messages, setMessages] = useState<HintMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [quota, setQuota] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<HintMessage>>(null);

  const load = useCallback(async () => {
    try {
      if (!assignmentId) return setError('No mission was passed to this screen.');

      const { data, error: hErr } = await getHintHistory(assignmentId);
      if (hErr) return setError(hErr);
      setMessages(data);

      const { familyId } = await getMyFamilyId();
      if (familyId) {
        const { remaining } = await getHintQuota(familyId);
        setQuota(remaining);
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load the chat.');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const question = draft.trim();
    if (!question || !assignmentId) return;

    setSending(true);
    setDraft('');

    //show question immediately; the server logs real row
    const optimistic: HintMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    const memberId = await readActiveProfile();
    const { data, error: aErr } = await askHint(assignmentId, memberId, question);
    setSending(false);

    if (aErr) {
      //roll optimistic message back so transcript stays honest
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(question);
      Alert.alert('Could not get a hint', aErr);
      return;
    }

    if (data) {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-reply-${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          created_at: new Date().toISOString(),
        },
      ]);
      setQuota(data.quota_remaining);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator />
        <Text style={{ fontSize: 12, color: '#999' }}>hints: loading</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 }}>
        <Text style={{ textAlign: 'center' }}>{error}</Text>
        <Button title="Back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const outOfHints = quota !== null && quota <= 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, paddingTop: 56 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingHorizontal: 20, marginBottom: 10 }}>
        <Text style={{ fontSize: 22, fontWeight: 'bold' }}>Stuck?</Text>
        <Text style={{ color: '#666', marginTop: 2 }}>
          Ask a question about this mission.
          {quota !== null ? ` ${quota} left today.` : ''}
        </Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={{ color: '#999', textAlign: 'center', paddingVertical: 30 }}>
            No questions yet. Try "what do I need?" or "how do I start?"
          </Text>
        }
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor: mine ? '#333' : '#f0f0f0',
                borderRadius: 14,
                paddingVertical: 10,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ color: mine ? 'white' : '#222', lineHeight: 20 }}>{item.content}</Text>
            </View>
          );
        }}
      />

      {sending ? (
        <View style={{ alignItems: 'center', paddingBottom: 8, gap: 6 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 12, color: '#999' }}>hints: thinking</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, padding: 16, alignItems: 'flex-end' }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!sending && !outOfHints}
          placeholder={outOfHints ? 'No hints left today' : 'Ask a question...'}
          maxLength={500}
          multiline
          style={{
            flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20,
            paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100,
            backgroundColor: outOfHints ? '#f5f5f5' : 'white',
          }}
        />
        <Button title="Ask" onPress={send} disabled={sending || outOfHints || draft.trim().length === 0} />
      </View>
    </KeyboardAvoidingView>
  );
}