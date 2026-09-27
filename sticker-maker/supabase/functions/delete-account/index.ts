import { errorResponse, handleOptions, json } from '../_shared/http.ts';
import { authenticate, serviceClient } from '../_shared/supabase.ts';

/**
 * App Store guideline 5.1.1(v): deleting the account must really delete the data.
 * Storage objects are removed first (they are not covered by the row cascade), then the
 * auth user goes, which cascades every table in public.
 */
Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  try {
    const caller = await authenticate(request);
    const service = serviceClient();

    await Promise.all([
      removeFolder(service, 'sources', caller.userId),
      removeFolder(service, 'stickers', caller.userId),
    ]);

    const { error } = await service.auth.admin.deleteUser(caller.userId);
    if (error) {
      throw new Error(error.message);
    }

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
});

async function removeFolder(
  service: ReturnType<typeof serviceClient>,
  bucket: string,
  userId: string,
): Promise<void> {
  let offset = 0;
  const pageSize = 100;

  for (;;) {
    const { data, error } = await service.storage
      .from(bucket)
      .list(userId, { limit: pageSize, offset });

    if (error) {
      console.error(`listing ${bucket}/${userId} failed`, error.message);
      return;
    }
    if (!data || data.length === 0) return;

    const paths = data.map((entry) => `${userId}/${entry.name}`);
    const { error: removeError } = await service.storage.from(bucket).remove(paths);
    if (removeError) {
      console.error(`removing from ${bucket} failed`, removeError.message);
      return;
    }

    if (data.length < pageSize) return;
    offset += pageSize;
  }
}
