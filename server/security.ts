import dns from 'node:dns/promises';
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import type { UserSettings } from '../src/shared/types.ts';

export const MASK_PREFIX = '••••••••';

const RESERVED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.arpa',
  '.lan',
  '.home',
  '.corp',
];

const RESERVED_EXACT_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const DNS_HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4_LITERAL_RE = /^\d+\.\d+\.\d+\.\d+$/;

export function getBindHost(): string {
  return (process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
}

export function isValidPublicDomain(domain: string): boolean {
  const lower = (domain || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!lower || lower.length > 253) return false;
  if (IPV4_LITERAL_RE.test(lower) || lower.includes(':') || net.isIP(lower) !== 0) {
    return false;
  }
  if (RESERVED_EXACT_HOSTS.has(lower)) return false;
  if (RESERVED_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return false;
  return DNS_HOSTNAME_RE.test(lower);
}

function isPrivateIpv4Octets(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local & cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

function expandIpv6Words(rawIp: string): number[] | null {
  let addr = rawIp.toLowerCase();
  const zoneIdx = addr.indexOf('%');
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  // Convert trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) to two hex groups
  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4Octets(addr.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = addr.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseGroups = (seg: string): number[] | null => {
    if (!seg) return [];
    const groups = seg.split(':');
    const nums: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      nums.push(parseInt(g, 16));
    }
    return nums;
  };

  if (doubleColonParts.length === 1) {
    const words = parseGroups(doubleColonParts[0]);
    return words && words.length === 8 ? words : null;
  }

  const left = parseGroups(doubleColonParts[0]);
  const right = parseGroups(doubleColonParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = (ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!cleaned) return true;

  const v4Octets = parseIpv4Octets(cleaned);
  if (v4Octets) {
    return isPrivateIpv4Octets(v4Octets[0], v4Octets[1], v4Octets[2], v4Octets[3]);
  }

  if (cleaned.includes(':')) {
    const words = expandIpv6Words(cleaned);
    if (!words) return true;

    const allZero = words.every((w) => w === 0);
    if (allZero) return true; // ::

    const isLoopback =
      words[0] === 0 &&
      words[1] === 0 &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      words[5] === 0 &&
      words[6] === 0 &&
      words[7] === 1;
    if (isLoopback) return true; // ::1

    // IPv4-mapped IPv6 (::ffff:0:0/96) or IPv4-compatible IPv6 (::/96)
    const isIpv4Mapped =
      words[0] === 0 &&
      words[1] === 0 &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      (words[5] === 0xffff || words[5] === 0);
    if (isIpv4Mapped) {
      const a = (words[6] >> 8) & 0xff;
      const b = words[6] & 0xff;
      const c = (words[7] >> 8) & 0xff;
      const d = words[7] & 0xff;
      return isPrivateIpv4Octets(a, b, c, d);
    }

    if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((words[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
    if ((words[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((words[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true; // 2001:db8::/32 documentation
    if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001) return true; // 64:ff9b:1::/48

    return false;
  }

  return true;
}

async function lookupAllAddressesWithTimeout(
  hostname: string,
  timeoutMs = 3500
): Promise<Array<{ address: string; family: number }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`DNS lookup timed out for ${hostname}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol "${parsed.protocol}" — only http and https are allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not permitted.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isValidPublicDomain(hostname) || (net.isIP(hostname) !== 0 && isPrivateOrReservedIp(hostname))) {
    throw new Error(`Target host "${hostname}" is not a valid public domain.`);
  }

  const records = await lookupAllAddressesWithTimeout(hostname, 3500);
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`DNS resolution returned no addresses for "${hostname}".`);
  }

  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(
        `Blocked request to "${hostname}": resolved to private or reserved IP address (${record.address}).`
      );
    }
  }

  return parsed;
}

export function assertSafeAiBaseUrl(rawUrl: string, allowLocalhost = true): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Base URL is not a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must use http:// or https://.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Base URL must not contain embedded credentials.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    throw new Error('Base URL must include a valid hostname.');
  }

  // Always block cloud metadata hosts and link-local addresses
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata' ||
    hostname === 'instance-data' ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('fe80:')
  ) {
    throw new Error(`Blocked unsafe metadata/link-local host "${hostname}".`);
  }

  if (net.isIP(hostname) !== 0) {
    const v4 = parseIpv4Octets(hostname);
    if (v4 && v4[0] === 169 && v4[1] === 254) {
      throw new Error(`Blocked unsafe link-local IP "${hostname}".`);
    }
    if (hostname.includes(':')) {
      const words = expandIpv6Words(hostname);
      if (!words || (words[0] & 0xffc0) === 0xfe80) {
        throw new Error(`Blocked unsafe link-local IPv6 host "${hostname}".`);
      }
      const isMapped =
        words[0] === 0 &&
        words[1] === 0 &&
        words[2] === 0 &&
        words[3] === 0 &&
        words[4] === 0 &&
        (words[5] === 0xffff || words[5] === 0);
      if (isMapped && ((words[6] >> 8) & 0xff) === 169 && (words[6] & 0xff) === 254) {
        throw new Error(`Blocked unsafe metadata IP "${hostname}".`);
      }
    }
  }

  if (!allowLocalhost) {
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      (net.isIP(hostname) !== 0 && isPrivateOrReservedIp(hostname))
    ) {
      throw new Error(`Localhost or private host "${hostname}" is not permitted here.`);
    }
  }

  return parsed;
}

export function sanitizeExternalHttpUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export interface SafeFetchHtmlOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  skipDnsCheck?: boolean;
}

export async function safeFetchHtml(
  url: string,
  options: SafeFetchHtmlOptions = {}
): Promise<{ html: string; finalUrl: string; status: number } | null> {
  const timeoutMs = options.timeoutMs ?? 8500;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 4;

  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (hop > 0 || !options.skipDnsCheck) {
      await assertSafePublicUrl(currentUrl);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: options.headers,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location || hop === maxRedirects) {
          return null;
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return null;
        }
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml')
      ) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }

      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
        controller.abort();
        await res.body?.cancel().catch(() => undefined);
        return null;
      }

      let html = '';
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const chunks: string[] = [];
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              controller.abort();
              await reader.cancel().catch(() => undefined);
              return null;
            }
            chunks.push(decoder.decode(value, { stream: true }));
          }
        }
        chunks.push(decoder.decode());
        html = chunks.join('');
      } else {
        const text = await res.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
          return null;
        }
        html = text;
      }

      if (!html || html.trim().length < 40) {
        return null;
      }

      return {
        html,
        finalUrl: res.url || currentUrl,
        status: res.status,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

export function isMaskedApiKey(value?: string | null): boolean {
  return Boolean(value && value.trim().startsWith(MASK_PREFIX));
}

export function maskApiKey(rawKey?: string | null): string {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) return '';
  if (isMaskedApiKey(trimmed)) return trimmed;
  if (trimmed.length <= 8) return MASK_PREFIX;
  return `${MASK_PREFIX}${trimmed.slice(-4)}`;
}

export function maskUserSettings(settings: UserSettings): UserSettings {
  return {
    ...settings,
    dbPath: './data/civiclead.db',
    localConfig: {
      ...settings.localConfig,
      apiKey: maskApiKey(settings.localConfig.apiKey),
      discoveredModels: [...settings.localConfig.discoveredModels],
    },
    externalConfig: {
      ...settings.externalConfig,
      apiKey: maskApiKey(settings.externalConfig.apiKey),
      discoveredModels: [...settings.externalConfig.discoveredModels],
    },
    searchConfig: {
      ...settings.searchConfig,
      apiKey: maskApiKey(settings.searchConfig.apiKey),
    },
  };
}

export function resolveApiKey(
  incomingKey: string | undefined,
  storedKey: string | undefined,
  envFallback?: string
): string {
  const trimmed = (incomingKey || '').trim();
  if (isMaskedApiKey(trimmed)) {
    return (storedKey || envFallback || '').trim();
  }
  if (trimmed) {
    return trimmed;
  }
  return (envFallback || '').trim();
}

export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
  }

  next();
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function extractRequestHostname(rawHeaderValue: string): string | null {
  const trimmed = rawHeaderValue.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    return new URL(trimmed).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

export function csrfOriginGuardMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestPath = req.originalUrl || req.path;
  if (!requestPath.startsWith('/api/') || !MUTATING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  const sourceHeader =
    typeof originHeader === 'string' && originHeader.length > 0
      ? originHeader
      : typeof refererHeader === 'string' && refererHeader.length > 0
        ? refererHeader
        : '';

  if (!sourceHeader) {
    next();
    return;
  }

  const sourceHost = extractRequestHostname(sourceHeader);
  if (!sourceHost) {
    res.status(403).json({ error: 'Cross-origin API request blocked by CSRF guard.' });
    return;
  }

  const allowedHosts = new Set<string>(['localhost', '127.0.0.1', '::1']);

  if (typeof req.headers.host === 'string' && req.headers.host.trim()) {
    try {
      const parsedHost = new URL(`http://${req.headers.host.trim()}`);
      allowedHosts.add(parsedHost.hostname.replace(/^\[|\]$/g, '').toLowerCase());
    } catch {
      // Ignore malformed Host header
    }
  }

  if (process.env.APP_URL) {
    const appHost = extractRequestHostname(process.env.APP_URL);
    if (appHost) allowedHosts.add(appHost);
  }

  if (!allowedHosts.has(sourceHost)) {
    res.status(403).json({ error: 'Cross-origin API request blocked by CSRF guard.' });
    return;
  }

  next();
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  const hits = new Map<string, number[]>();
  const message =
    options.message || 'Rate limit exceeded. Please wait before trying again.';

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const clientKey = req.ip || req.socket.remoteAddress || 'local';

    if (hits.size > 1000) {
      for (const [k, timestamps] of hits.entries()) {
        const recent = timestamps.filter((t) => t > cutoff);
        if (recent.length === 0) {
          hits.delete(k);
        } else {
          hits.set(k, recent);
        }
      }
    }

    const existing = (hits.get(clientKey) || []).filter((t) => t > cutoff);
    if (existing.length >= options.maxRequests) {
      res.status(429).json({ error: message });
      return;
    }

    existing.push(now);
    hits.set(clientKey, existing);
    next();
  };
}
