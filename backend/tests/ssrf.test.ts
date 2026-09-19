import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSafeUpstreamUrl,
  isPrivateHostname,
  getValidatedOpenAiBaseUrl,
  resetValidatedBaseUrlCache,
  UnsafeUrlError,
} from '../src/security/ssrf.js';
import { config } from '../src/config.js';

// Vitest sets NODE_ENV='test' (not 'development'), so getValidatedOpenAiBaseUrl
// runs the production policy unless a test opts into allowPrivate explicitly.

const PROD = { allowPrivate: false };
const DEV = { allowPrivate: true };

describe('isPrivateHostname', () => {
  it('flags localhost, loopback, private, and link-local hosts', () => {
    for (const h of [
      'localhost',
      'api.localhost',
      '127.0.0.1',
      '127.9.9.9',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '::1',
      '[::1]',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateHostname(h), h).toBe(true);
    }
  });

  it('treats public hosts and public IPs as safe', () => {
    for (const h of ['api.openai.com', 'example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '1.1.1.1']) {
      expect(isPrivateHostname(h), h).toBe(false);
    }
  });
});

describe('assertSafeUpstreamUrl — production policy', () => {
  it('accepts an external https URL', () => {
    expect(() => assertSafeUpstreamUrl('https://api.openai.com/v1', PROD)).not.toThrow();
    expect(() => assertSafeUpstreamUrl('https://gateway.example.com/openai', PROD)).not.toThrow();
  });

  it('rejects http (non-https) in production', () => {
    expect(() => assertSafeUpstreamUrl('http://api.openai.com/v1', PROD)).toThrow(UnsafeUrlError);
  });

  it('rejects localhost and internal IPs in production', () => {
    for (const u of [
      'https://localhost/v1',
      'https://127.0.0.1:8080/v1',
      'https://10.0.0.5/v1',
      'https://192.168.0.10/v1',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/v1',
    ]) {
      expect(() => assertSafeUpstreamUrl(u, PROD), u).toThrow(UnsafeUrlError);
    }
  });

  it('rejects a malformed URL', () => {
    expect(() => assertSafeUpstreamUrl('not-a-url', PROD)).toThrow(UnsafeUrlError);
  });
});

describe('assertSafeUpstreamUrl — development policy', () => {
  it('allows localhost / internal IPs and http in dev', () => {
    for (const u of [
      'http://localhost:11434/v1',
      'https://127.0.0.1:8080/v1',
      'http://10.0.0.5/v1',
      'http://192.168.0.10:1234/v1',
    ]) {
      expect(() => assertSafeUpstreamUrl(u, DEV), u).not.toThrow();
    }
  });

  it('still rejects exotic schemes in dev', () => {
    expect(() => assertSafeUpstreamUrl('file:///etc/passwd', DEV)).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl('gopher://internal/', DEV)).toThrow(UnsafeUrlError);
  });
});

describe('getValidatedOpenAiBaseUrl (config-driven, prod policy under NODE_ENV=test)', () => {
  const originalBase = config.openaiBaseUrl;
  afterEach(() => {
    config.openaiBaseUrl = originalBase;
    resetValidatedBaseUrlCache();
  });

  it('passes for the default external https base URL', () => {
    resetValidatedBaseUrlCache();
    expect(getValidatedOpenAiBaseUrl()).toBe(originalBase);
  });

  it('throws when OPENAI_BASE_URL points at an internal host', () => {
    config.openaiBaseUrl = 'https://169.254.169.254/v1';
    resetValidatedBaseUrlCache();
    expect(() => getValidatedOpenAiBaseUrl()).toThrow(UnsafeUrlError);
  });

  it('throws when OPENAI_BASE_URL is http in production mode', () => {
    config.openaiBaseUrl = 'http://api.openai.com/v1';
    resetValidatedBaseUrlCache();
    expect(() => getValidatedOpenAiBaseUrl()).toThrow(UnsafeUrlError);
  });
});
