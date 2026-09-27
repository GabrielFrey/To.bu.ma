import { exportRequestId } from '../../../domain/idempotency';
import type { Sticker } from '../../../domain/types';
import { runExport } from '../exportService';

// `jest.mock` factories are hoisted above the imports, so the doubles they reference have
// to be declared with `mock`-prefixed names.
const mockSendPackToWhatsApp = jest.fn<Promise<boolean>, [unknown]>();
const mockIsAppInstalled = jest.fn<boolean, [string]>();
const mockSaveToLibrary = jest.fn<Promise<void>, [string]>();
const mockRequestPermissions = jest.fn<Promise<{ granted: boolean }>, [boolean?]>();
const mockRpc = jest.fn<Promise<{ error: { message: string } | null }>, [string, unknown?]>();
const mockInvoke = jest.fn<Promise<unknown>, [string, unknown]>();

jest.mock('../../../../modules/sticker-export', () => ({
  isAppInstalled: (app: string) => mockIsAppInstalled(app),
  sendPackToWhatsApp: (payload: unknown) => mockSendPackToWhatsApp(payload),
  sendPackToTelegram: jest.fn(async () => true),
  copyStickersToAppGroup: jest.fn(async () => 0),
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: (writeOnly?: boolean) => mockRequestPermissions(writeOnly),
  saveToLibraryAsync: (uri: string) => mockSaveToLibrary(uri),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('../../../lib/storage', () => ({
  localStickerUri: jest.fn(async (path: string) => `file:///cache/${path}`),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (name: string, args?: unknown) => mockRpc(name, args) },
  invokeEdgeFunction: (name: string, body: unknown) => mockInvoke(name, body),
}));

function sticker(id: string): Sticker {
  return {
    id,
    generationId: null,
    pngPath: `user/${id}.png`,
    webpPath: `user/${id}.webp`,
    emojis: ['😀'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const PACK_RESPONSE = {
  target: 'whatsapp',
  stickerIds: ['a', 'b', 'c'],
  payload: {
    identifier: 'pack-1',
    name: 'Pack',
    publisher: 'Sticker Studio',
    trayImageData: '',
    stickers: [],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ error: null });
  mockIsAppInstalled.mockReturnValue(true);
  mockRequestPermissions.mockResolvedValue({ granted: true });
  mockInvoke.mockResolvedValue(PACK_RESPONSE);
});

function chargeCalls() {
  return mockRpc.mock.calls.filter(([name]) => name === 'consume_credits');
}

describe('runExport credit rules', () => {
  it('charges one credit per sticker after a successful save to Photos', async () => {
    const result = await runExport({
      target: 'gallery',
      packId: null,
      stickers: [sticker('a'), sticker('b')],
    });

    expect(result).toMatchObject({ outcome: 'exported', creditsCharged: 2 });
    expect(mockSaveToLibrary).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith(
      'consume_credits',
      expect.objectContaining({ p_kind: 'export', p_amount: 2 }),
    );
  });

  it('charges nothing when the user backs out of the WhatsApp sheet', async () => {
    mockSendPackToWhatsApp.mockResolvedValue(false);

    const result = await runExport({
      target: 'whatsapp',
      packId: 'pack-1',
      stickers: [sticker('a'), sticker('b'), sticker('c')],
    });

    expect(result).toMatchObject({ outcome: 'cancelled', creditsCharged: 0 });
    expect(chargeCalls()).toHaveLength(0);
  });

  it('reuses the same request id for a repeated export of the same stickers', async () => {
    mockSendPackToWhatsApp.mockResolvedValue(true);
    const stickers = [sticker('a'), sticker('b'), sticker('c')];

    await runExport({ target: 'whatsapp', packId: 'pack-1', stickers });
    await runExport({ target: 'whatsapp', packId: 'pack-1', stickers });

    const requestIds = chargeCalls().map(
      ([, args]) => (args as { p_request_id: string }).p_request_id,
    );

    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
    expect(requestIds[0]).toBe(exportRequestId('pack-1', ['a', 'b', 'c']));
  });

  it('claims the one-shot first export bonus after a successful hand-off', async () => {
    await runExport({ target: 'gallery', packId: null, stickers: [sticker('a')] });

    expect(mockRpc).toHaveBeenCalledWith('claim_first_export_bonus', undefined);
  });

  it('surfaces an empty balance as insufficient_credits', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'insufficient_credits' } });

    await expect(
      runExport({ target: 'gallery', packId: null, stickers: [sticker('a')] }),
    ).rejects.toMatchObject({ code: 'insufficient_credits' });
  });

  it('refuses a WhatsApp export when WhatsApp is missing, before any charge', async () => {
    mockIsAppInstalled.mockReturnValue(false);

    await expect(
      runExport({ target: 'whatsapp', packId: 'pack-1', stickers: [sticker('a')] }),
    ).rejects.toMatchObject({ code: 'app_not_installed' });
    expect(chargeCalls()).toHaveLength(0);
  });

  it('refuses to export an empty selection', async () => {
    await expect(
      runExport({ target: 'gallery', packId: null, stickers: [] }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
