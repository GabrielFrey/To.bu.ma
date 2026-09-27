import * as SecureStore from 'expo-secure-store';

import { chunkedSecureStorage } from '../secureStorage';

describe('chunkedSecureStorage', () => {
  it('round-trips a small value in a single keychain item', async () => {
    await chunkedSecureStorage.setItem('session', 'short');
    expect(await chunkedSecureStorage.getItem('session')).toBe('short');
    expect(await SecureStore.getItemAsync('session')).toBe('short');
  });

  it('round-trips a value larger than the keychain comfort zone', async () => {
    const big = 'j'.repeat(9000);
    await chunkedSecureStorage.setItem('big', big);
    expect(await chunkedSecureStorage.getItem('big')).toBe(big);
    expect(await SecureStore.getItemAsync('big__chunks')).toBe('5');
  });

  it('drops a partially written value instead of returning a corrupt session', async () => {
    await chunkedSecureStorage.setItem('torn', 'x'.repeat(4000));
    await SecureStore.deleteItemAsync('torn__1');
    expect(await chunkedSecureStorage.getItem('torn')).toBeNull();
    expect(await SecureStore.getItemAsync('torn__chunks')).toBeNull();
  });

  it('cleans up old chunks when a large value is replaced by a small one', async () => {
    await chunkedSecureStorage.setItem('shrink', 'y'.repeat(5000));
    await chunkedSecureStorage.setItem('shrink', 'tiny');
    expect(await chunkedSecureStorage.getItem('shrink')).toBe('tiny');
    expect(await SecureStore.getItemAsync('shrink__0')).toBeNull();
    expect(await SecureStore.getItemAsync('shrink__chunks')).toBeNull();
  });

  it('removes every chunk on sign out', async () => {
    await chunkedSecureStorage.setItem('gone', 'z'.repeat(5000));
    await chunkedSecureStorage.removeItem('gone');
    expect(await chunkedSecureStorage.getItem('gone')).toBeNull();
    expect(await SecureStore.getItemAsync('gone__0')).toBeNull();
  });
});
