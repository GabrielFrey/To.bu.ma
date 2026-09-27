import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';

import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

/** Blocks input during an operation that must not be started twice, e.g. an export. */
export function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated }]}>
          <ActivityIndicator color={theme.colors.brand} size="large" />
          {message ? (
            <AppText variant="callout" center>
              {message}
            </AppText>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    minWidth: 180,
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
  },
});
