import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases';

import { env, isProduction } from '../config/env';

import { captureError } from './observability';

/**
 * RevenueCat owns StoreKit. Credits are granted by its webhook, never by this client,
 * so a successful purchase here only means "wait for the balance to refresh".
 */

let configured = false;

export function isStoreConfigured(): boolean {
  return configured;
}

export function configurePurchases(userId: string): void {
  if (!env.revenueCatKey) {
    if (__DEV__) {
      console.warn('RevenueCat key missing: the paywall will show as unavailable');
    }
    return;
  }

  if (!configured) {
    Purchases.setLogLevel(isProduction ? LOG_LEVEL.ERROR : LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey: env.revenueCatKey, appUserID: userId });
    configured = true;
    return;
  }

  // Anonymous -> signed in: move the purchases to the real app user id.
  void Purchases.logIn(userId).catch((error: unknown) => {
    captureError(error, { scope: 'purchases.logIn' });
  });
}

export async function logOutPurchases(): Promise<void> {
  if (!configured) return;
  await Purchases.logOut().catch(() => undefined);
}

export interface PaywallProduct {
  identifier: string;
  title: string;
  description: string;
  priceString: string;
  isSubscription: boolean;
  /** e.g. `P1M`; used to render the mandatory renewal sentence. */
  subscriptionPeriod: string | null;
  rcPackage: PurchasesPackage;
}

export async function fetchPaywallProducts(): Promise<PaywallProduct[]> {
  if (!configured) return [];

  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];

  return current.availablePackages.map((rcPackage) => ({
    identifier: rcPackage.identifier,
    title: rcPackage.product.title,
    description: rcPackage.product.description,
    // Always the store's localized price string, never a hardcoded number.
    priceString: rcPackage.product.priceString,
    isSubscription: rcPackage.product.subscriptionPeriod !== null,
    subscriptionPeriod: rcPackage.product.subscriptionPeriod ?? null,
    rcPackage,
  }));
}

export type PurchaseOutcome = 'purchased' | 'cancelled';

export async function purchase(product: PaywallProduct): Promise<PurchaseOutcome> {
  try {
    await Purchases.purchasePackage(product.rcPackage);
    return 'purchased';
  } catch (error) {
    if (isUserCancellation(error)) {
      return 'cancelled';
    }
    throw error;
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!configured) return false;
  const info = await Purchases.restorePurchases();
  const hasEntitlements = Object.keys(info.entitlements.active).length > 0;
  const hasHistory = info.allPurchasedProductIdentifiers.length > 0;
  return hasEntitlements || hasHistory;
}

function isUserCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { userCancelled?: boolean; code?: string };
  return record.userCancelled === true || record.code === '1';
}
