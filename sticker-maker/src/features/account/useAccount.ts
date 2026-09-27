import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clearCache } from '../../lib/fileCache';
import { clearPushToken } from '../../lib/notifications';
import { resetIdentity, track } from '../../lib/observability';
import { logOutPurchases } from '../../lib/purchases';
import { invokeEdgeFunction } from '../../lib/supabase';
import { signOut } from '../auth/authApi';
import { useAuth } from '../auth/AuthProvider';

/**
 * App Store guideline 5.1.1(v): the account must be deletable from inside the app, and
 * deletion must be real. The Edge Function removes the storage objects and then the auth
 * user, which cascades every table.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();

  return useMutation<void, unknown, void>({
    mutationFn: async () => {
      if (userId) {
        await clearPushToken(userId).catch(() => undefined);
      }
      await invokeEdgeFunction('delete-account', {});
      await signOut();
    },
    onSuccess: async () => {
      track('account_deleted');
      resetIdentity();
      await logOutPurchases();
      await clearCache().catch(() => undefined);
      queryClient.clear();
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();

  return useMutation<void, unknown, void>({
    mutationFn: async () => {
      if (userId) {
        await clearPushToken(userId).catch(() => undefined);
      }
      await signOut();
    },
    onSuccess: async () => {
      resetIdentity();
      await logOutPurchases();
      queryClient.clear();
    },
  });
}
