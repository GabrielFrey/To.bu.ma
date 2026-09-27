import { errorResponse, envInt, json, requireEnv } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';

/**
 * Credits are granted here, never by the app. The app only tells RevenueCat to buy;
 * RevenueCat validates the StoreKit transaction and calls this endpoint, so a patched
 * client cannot mint credits.
 *
 * Product ids map to credit bundles. Keep this table in sync with App Store Connect.
 */
const CREDIT_BUNDLES: Record<string, { generation: number; export: number }> = {
  credits_generation_10: { generation: 10, export: 0 },
  credits_generation_50: { generation: 50, export: 0 },
  credits_export_10: { generation: 0, export: 10 },
  credits_bundle_starter: { generation: 20, export: 10 },
  sub_monthly_pro: { generation: 100, export: 60 },
  sub_yearly_pro: { generation: 1200, export: 720 },
};

interface RevenueCatEvent {
  event?: {
    id?: string;
    type?: string;
    app_user_id?: string;
    original_app_user_id?: string;
    product_id?: string;
    store?: string;
    transaction_id?: string;
    environment?: string;
  };
}

const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
]);

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ code: 'invalid_request', message: 'POST only' }, 405);
  }

  try {
    const expected = requireEnv('REVENUECAT_WEBHOOK_SECRET');
    const provided = request.headers.get('Authorization') ?? '';
    // RevenueCat sends the configured value verbatim in the Authorization header.
    if (provided !== expected && provided !== `Bearer ${expected}`) {
      return json({ code: 'forbidden', message: 'Bad webhook secret' }, 401);
    }

    const body = (await request.json()) as RevenueCatEvent;
    const event = body.event;
    if (!event?.type || !event.app_user_id) {
      return json({ code: 'invalid_request', message: 'Missing event fields' }, 400);
    }

    if (!GRANTING_EVENTS.has(event.type)) {
      // Cancellations and billing issues do not remove already granted credits.
      return json({ ok: true, ignored: event.type });
    }

    const bundle = event.product_id ? CREDIT_BUNDLES[event.product_id] : undefined;
    if (!bundle) {
      console.error('unknown product id', event.product_id);
      return json({ ok: true, ignored: 'unknown_product' });
    }

    const service = serviceClient();
    const userId = event.app_user_id;
    const transactionId = event.transaction_id ?? event.id ?? crypto.randomUUID();

    const { error: purchaseError } = await service.from('purchases').insert({
      user_id: userId,
      store: event.store ?? 'unknown',
      product_id: event.product_id ?? 'unknown',
      transaction_id: transactionId,
      generation_credits_granted: bundle.generation,
      export_credits_granted: bundle.export,
      raw: body as unknown as Record<string, unknown>,
    });

    // A redelivered webhook hits the unique transaction_id and stops here.
    if (purchaseError) {
      if (purchaseError.code === '23505' || purchaseError.message.includes('duplicate key')) {
        return json({ ok: true, duplicate: true });
      }
      throw new Error(purchaseError.message);
    }

    if (bundle.generation > 0) {
      await service.rpc('grant_credits', {
        p_kind: 'generation',
        p_amount: bundle.generation,
        p_reason: 'purchase',
        p_request_id: `purchase_generation_${transactionId}`,
        p_user_id: userId,
      });
    }
    if (bundle.export > 0) {
      await service.rpc('grant_credits', {
        p_kind: 'export',
        p_amount: bundle.export,
        p_reason: 'purchase',
        p_request_id: `purchase_export_${transactionId}`,
        p_user_id: userId,
      });
    }

    return json({
      ok: true,
      granted: bundle,
      sandbox: event.environment === 'SANDBOX',
      retryAfter: envInt('REVENUECAT_RETRY_SECONDS', 0),
    });
  } catch (error) {
    return errorResponse(error);
  }
});
