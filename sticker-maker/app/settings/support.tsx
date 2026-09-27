import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useSendSupportMessage } from '../../src/features/support/useSupport';
import { spacing } from '../../src/theme';

export default function SupportScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const send = useSendSupportMessage();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Screen contentStyle={styles.sent}>
        <AppText variant="title" center>
          {t('support.sentTitle')}
        </AppText>
        <AppText variant="body" tone="muted" center>
          {t('support.sentBody')}
        </AppText>
        <Button label={t('common.close')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <TextField
        label={t('support.subject')}
        placeholder={t('support.subjectPlaceholder')}
        value={subject}
        onChangeText={setSubject}
        maxLength={120}
        showCounter
      />
      <TextField
        label={t('support.message')}
        placeholder={t('support.messagePlaceholder')}
        value={body}
        onChangeText={setBody}
        maxLength={4000}
        multiline
      />

      <Banner tone="info" message={t('support.diagnosticsNote')} />

      {send.isError ? <ErrorState error={send.error} compact /> : null}

      <Button
        label={send.isPending ? t('support.sending') : t('support.send')}
        loading={send.isPending}
        disabled={subject.trim().length < 2 || body.trim().length < 5}
        onPress={() =>
          send.mutate(
            { subject, body, locale: i18n.language },
            { onSuccess: () => setSent(true) },
          )
        }
        testID="send-support"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  sent: { flex: 1, justifyContent: 'center', gap: spacing.lg },
});
