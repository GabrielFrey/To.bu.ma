import { useMutation } from '@tanstack/react-query';

import { track } from '../../lib/observability';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

export const REPORT_REASONS = [
  'sexual',
  'violent',
  'hate',
  'impersonation',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportInput {
  stickerId: string | null;
  reason: ReportReason;
  details: string | null;
}

/**
 * App Store guideline 1.2 requires a way to report generated content. Reports are
 * write-only for the user: they can file one but cannot read or edit the queue.
 */
export function useReportSticker() {
  const { userId } = useAuth();

  return useMutation<void, unknown, ReportInput>({
    mutationFn: async ({ stickerId, reason, details }) => {
      if (!userId) throw Object.assign(new Error('No session'), { code: 'unauthenticated' });

      const { error } = await supabase.from('reports').insert({
        user_id: userId,
        sticker_id: stickerId,
        reason,
        details: details?.trim() ? details.trim().slice(0, 1000) : null,
      });

      if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
    },
    onSuccess: (_result, variables) => {
      track('report_submitted', { reason: variables.reason });
    },
  });
}
