import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../src/components/AppText';
import { Banner } from '../src/components/Banner';
import { Button } from '../src/components/Button';
import { Chip } from '../src/components/Chip';
import { ErrorState } from '../src/components/ErrorState';
import { Screen } from '../src/components/Screen';
import { TextField } from '../src/components/TextField';
import {
  REPORT_REASONS,
  useReportSticker,
  type ReportReason,
} from '../src/features/moderation/useReport';
import { spacing } from '../src/theme';

const REASON_LABELS: Record<ReportReason, string> = {
  sexual: 'moderation.reportReasonSexual',
  violent: 'moderation.reportReasonViolent',
  hate: 'moderation.reportReasonHate',
  impersonation: 'moderation.reportReasonImpersonation',
  other: 'moderation.reportReasonOther',
};

export default function ReportScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { stickerId } = useLocalSearchParams<{ stickerId?: string }>();

  const report = useReportSticker();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Screen contentStyle={styles.sent}>
        <Banner tone="success" message={t('moderation.reportSent')} />
        <Button label={t('common.close')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="headline">{t('moderation.reportTitle')}</AppText>

      <View style={styles.reasons}>
        {REPORT_REASONS.map((value) => (
          <Chip
            key={value}
            label={t(REASON_LABELS[value])}
            selected={reason === value}
            onPress={() => setReason(value)}
            testID={`report-reason-${value}`}
          />
        ))}
      </View>

      <TextField
        label={t('moderation.reportDetails')}
        value={details}
        onChangeText={setDetails}
        maxLength={1000}
        multiline
      />

      {report.isError ? <ErrorState error={report.error} compact /> : null}

      <Button
        label={t('moderation.reportSend')}
        disabled={reason === null}
        loading={report.isPending}
        onPress={() => {
          if (!reason) return;
          report.mutate(
            { stickerId: stickerId ?? null, reason, details: details || null },
            { onSuccess: () => setSent(true) },
          );
        }}
        testID="send-report"
      />
      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  sent: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  reasons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
