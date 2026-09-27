import { useMutation } from '@tanstack/react-query';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { invokeEdgeFunction } from '../../lib/supabase';

export interface SupportInput {
  subject: string;
  body: string;
  locale: string;
  lastGenerationId?: string;
  lastErrorCode?: string;
}

/**
 * Diagnostics are attached automatically because users cannot be expected to know their
 * build number. Deliberately nothing about the photos, the prompts or the session.
 */
export function useSendSupportMessage() {
  return useMutation<void, unknown, SupportInput>({
    mutationFn: async (input) => {
      await invokeEdgeFunction('support-message', {
        subject: input.subject.trim(),
        body: input.body.trim(),
        diagnostics: {
          appVersion: Application.nativeApplicationVersion ?? 'unknown',
          buildNumber: Application.nativeBuildVersion ?? 'unknown',
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          locale: input.locale,
          ...(input.lastGenerationId ? { lastGenerationId: input.lastGenerationId } : null),
          ...(input.lastErrorCode ? { lastErrorCode: input.lastErrorCode } : null),
        },
      });
    },
  });
}
