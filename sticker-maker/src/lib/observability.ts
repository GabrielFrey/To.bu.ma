import * as Sentry from '@sentry/react-native';
import { PostHog } from 'posthog-react-native';

import { env, isProduction } from '../config/env';

let posthog: PostHog | null = null;

export function initObservability(): void {
  if (env.sentryDsn) {
    Sentry.init({
      dsn: env.sentryDsn,
      environment: env.environment,
      // Traces are useful but expensive; keep a small sample in production.
      tracesSampleRate: isProduction ? 0.1 : 1,
      enableAutoSessionTracking: true,
      sendDefaultPii: false,
    });
  }

  if (env.posthogKey && !posthog) {
    posthog = new PostHog(env.posthogKey, { host: env.posthogHost });
  }
}

export type AnalyticsEvent =
  | 'onboarding_completed'
  | 'sign_in_started'
  | 'sign_in_succeeded'
  | 'sign_in_failed'
  | 'photo_selected'
  | 'idea_suggested'
  | 'generation_started'
  | 'generation_succeeded'
  | 'generation_failed'
  | 'sticker_feedback'
  | 'pack_created'
  | 'export_started'
  | 'export_succeeded'
  | 'export_cancelled'
  | 'paywall_shown'
  | 'purchase_started'
  | 'purchase_succeeded'
  | 'purchase_failed'
  | 'purchases_restored'
  | 'report_submitted'
  | 'account_deleted';

/** Event properties are deliberately scalar: no photos, no prompts, no user text. */
export type AnalyticsProperties = Record<string, string | number | boolean | null>;

export function track(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
  posthog?.capture(event, properties);
  Sentry.addBreadcrumb({ category: 'analytics', message: event, data: properties });
}

export function identify(userId: string, isAnonymous: boolean): void {
  posthog?.identify(userId, { is_anonymous: isAnonymous });
  Sentry.setUser({ id: userId });
}

export function resetIdentity(): void {
  posthog?.reset();
  Sentry.setUser(null);
}

/** Honors the Settings toggle; PostHog stops sending anything while opted out. */
export function setAnalyticsEnabled(enabled: boolean): void {
  if (!posthog) return;
  if (enabled) {
    posthog.optIn();
  } else {
    posthog.optOut();
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
  if (__DEV__) {
    console.error(error, context);
  }
}
