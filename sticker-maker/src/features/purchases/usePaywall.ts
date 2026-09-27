import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { errorCodeOf } from '../../lib/errors';
import { track } from '../../lib/observability';
import {
  fetchPaywallProducts,
  isStoreConfigured,
  purchase,
  restorePurchases,
  type PaywallProduct,
  type PurchaseOutcome,
} from '../../lib/purchases';
import { queryKeys } from '../../lib/queryClient';

export function usePaywallProducts() {
  return useQuery({
    queryKey: queryKeys.offerings,
    queryFn: fetchPaywallProducts,
    // Prices come from StoreKit and change rarely, but a stale empty list looks broken.
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useStoreAvailable(): boolean {
  return isStoreConfigured();
}

/**
 * A completed purchase does not grant credits here. RevenueCat's webhook validates the
 * receipt server-side and calls `grant_credits`, so the client only waits for the balance
 * to arrive over Realtime. That is what makes a jailbroken receipt worthless.
 */
export function usePurchase() {
  const queryClient = useQueryClient();

  return useMutation<PurchaseOutcome, unknown, PaywallProduct>({
    mutationFn: (product) => {
      track('purchase_started', { product: product.identifier });
      return purchase(product);
    },
    onSuccess: (outcome, product) => {
      if (outcome === 'purchased') {
        track('purchase_succeeded', { product: product.identifier });
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      }
    },
    onError: (error, product) => {
      track('purchase_failed', { product: product.identifier, code: errorCodeOf(error) });
    },
  });
}

export function useRestorePurchases() {
  const queryClient = useQueryClient();

  return useMutation<boolean, unknown, void>({
    mutationFn: restorePurchases,
    onSuccess: (restored) => {
      track('purchases_restored', { restored });
      if (restored) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      }
    },
  });
}

/** Turns `P1M` / `P1Y` into the i18n key used by the renewal disclosure. */
export function subscriptionPeriodKey(period: string | null): string | null {
  if (!period) return null;
  switch (period) {
    case 'P1W':
      return 'paywall.periodWeek';
    case 'P1M':
      return 'paywall.periodMonth';
    case 'P3M':
      return 'paywall.periodQuarter';
    case 'P6M':
      return 'paywall.periodHalfYear';
    case 'P1Y':
      return 'paywall.periodYear';
    default:
      return null;
  }
}
