import { useMutation, useQueryClient } from '@tanstack/react-query';

import { errorCodeOf } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { queryKeys } from '../../lib/queryClient';

import { runExport, type ExportInput, type ExportResult } from './exportService';

export function useExport() {
  const queryClient = useQueryClient();

  return useMutation<ExportResult, unknown, ExportInput>({
    mutationFn: runExport,
    onSuccess: (result) => {
      if (result.creditsCharged > 0) {
        haptics.success();
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      }
    },
    onError: (error) => {
      // A missing app or an empty balance is a normal outcome, not a crash-worthy one.
      if (errorCodeOf(error) === 'insufficient_credits') {
        haptics.warning();
      } else {
        haptics.error();
      }
    },
  });
}
