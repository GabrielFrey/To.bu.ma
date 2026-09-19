import { config } from '../config.js';

/**
 * SSRF guard for the operator-configured upstream base URL (`OPENAI_BASE_URL`).
 *
 * A custom base URL is attacker-interesting: if it can point at `localhost`, the
 * cloud metadata endpoint (169.254.169.254), or an internal RFC1918 address, a
 * proxied request becomes a server-side request forgery into the private network.
 *
 * Policy (production / default):
 *   - scheme MUST be https (no http, file, gopher, …)
 *   - host MUST NOT be localhost, loopback, link-local, or a private IP literal
 *
 * `NODE_ENV=development` relaxes both (http + localhost/private allowed) so local
 * stacks and emulators work.
 */
export class UnsafeUrlError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/** Only NODE_ENV=development relaxes the SSRF policy. */
export function isDevMode(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * True if `host` is a loopback/private/link-local literal (or `localhost`).
 * DNS names that are not IP literals are treated as public (we do not resolve —
 * DNS-rebinding defense is out of scope for this guard).
 */
export function isPrivateHostname(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // strip IPv6 brackets
  if (h.length === 0) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return true; // malformed → treat as unsafe
    const [a, b] = octets;
    if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 10) return true; // private 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
    if (a === 192 && b === 168) return true; // private 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (incl. cloud metadata)
    return false;
  }

  if (h.includes(':')) {
    // IPv6 literal.
    if (h === '::1' || h === '::') return true; // loopback / unspecified
    const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateHostname(mapped[1]); // IPv4-mapped
    const first = h.split(':')[0];
    if (first.startsWith('fc') || first.startsWith('fd')) return true; // fc00::/7 unique-local
    if (['fe8', 'fe9', 'fea', 'feb'].some((p) => first.startsWith(p))) return true; // fe80::/10 link-local
    return false;
  }

  return false; // public DNS name
}

/**
 * Validate a candidate upstream URL, throwing `UnsafeUrlError` if it violates the
 * SSRF policy. Returns the parsed `URL` on success.
 */
export function assertSafeUpstreamUrl(raw: string, opts: { allowPrivate?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Invalid upstream URL: ${raw}`);
  }
  const allowPrivate = opts.allowPrivate ?? false;

  if (allowPrivate) {
    // Dev: allow http + https (localhost stacks), reject exotic schemes.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new UnsafeUrlError(`Unsupported URL scheme "${url.protocol}" for upstream URL`);
    }
    return url;
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError(
      `Upstream URL must use https in production (got "${url.protocol}"). Set NODE_ENV=development to allow http.`
    );
  }
  if (isPrivateHostname(url.hostname)) {
    throw new UnsafeUrlError(
      `Refusing to use a private/loopback upstream host "${url.hostname}". Set NODE_ENV=development to allow it.`
    );
  }
  return url;
}

let cachedBaseUrl: string | null = null;

/**
 * Validate and return the configured `OPENAI_BASE_URL`, memoized. Called at each
 * outbound sink (real provider path, proxy upstream, embeddings) so a dangerous
 * base URL is refused before any request leaves the process.
 */
export function getValidatedOpenAiBaseUrl(): string {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  assertSafeUpstreamUrl(config.openaiBaseUrl, { allowPrivate: isDevMode() });
  cachedBaseUrl = config.openaiBaseUrl;
  return cachedBaseUrl;
}

/** Validate an arbitrary upstream base URL under the current mode. Throws if unsafe. */
export function assertConfiguredUpstreamUrl(raw: string): void {
  assertSafeUpstreamUrl(raw, { allowPrivate: isDevMode() });
}

/** Test hook: clear the memoized validated base URL. */
export function resetValidatedBaseUrlCache(): void {
  cachedBaseUrl = null;
}
