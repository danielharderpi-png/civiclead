import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type {
  DiscoveredBusiness,
  SearchApiConfig,
  SearchApiProvider,
} from '../src/shared/types.ts';
import { normalizeDomain } from './crawler.ts';

const BLOCKED_DOMAINS = new Set([
  'yelp.com',
  'yellowpages.com',
  'facebook.com',
  'bbb.org',
  'angi.com',
  'angieslist.com',
  'homeadvisor.com',
  'linkedin.com',
  'mapquest.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'thumbtack.com',
  'houzz.com',
  'buildzoom.com',
  'manta.com',
  'dnb.com',
  'zoominfo.com',
  'chamberofcommerce.com',
  'nextdoor.com',
  'apple.com',
  'google.com',
  'duckduckgo.com',
  'bing.com',
  'wikipedia.org',
  'indeed.com',
  'glassdoor.com',
  'superpages.com',
  'whitepages.com',
  'alignable.com',
  'porch.com',
  'expertise.com',
  'threebestrated.com',
  'birdeye.com',
  'mapcarta.com',
  'foursquare.com',
  'yellowbook.com',
  'crunchbase.com',
  'localsearch.com',
  'yp.com',
  'dexknows.com',
  'thebluebook.com',
  'patch.com',
]);

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function isBlockedDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (!lower || !lower.includes('.')) return true;
  if (/\.(?:gov|edu|mil)(?:\.[a-z]{2})?$/i.test(lower)) return true;
  if (/(?:local|news)\.com$/i.test(lower)) return true;
  if (BLOCKED_DOMAINS.has(lower)) return true;
  for (const blocked of BLOCKED_DOMAINS) {
    if (lower.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function unwrapDuckDuckGoUrl(rawHref: string): string {
  if (!rawHref) return '';
  try {
    if (rawHref.startsWith('//')) {
      rawHref = `https:${rawHref}`;
    }
    if (rawHref.includes('uddg=')) {
      const parsed = new URL(
        rawHref.startsWith('http') ? rawHref : `https://duckduckgo.com${rawHref}`
      );
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
    if (rawHref.startsWith('http')) return rawHref;
    return '';
  } catch {
    return '';
  }
}

function buildBusinessFromSearchItem(
  rawUrl: string,
  rawTitle: string,
  snippet: string,
  source: DiscoveredBusiness['source'],
  locality: string,
  trade: string
): DiscoveredBusiness | null {
  if (!rawUrl) return null;
  const { domain, baseUrl } = normalizeDomain(rawUrl);
  if (!domain || isBlockedDomain(domain)) return null;
  const cleanName = (rawTitle || '').split(/[|\-–:]/)[0]?.trim() || domain;
  return {
    id: crypto.randomUUID(),
    companyName: cleanName,
    domain,
    websiteUrl: baseUrl,
    source,
    locality,
    categories: (snippet || '').slice(0, 90) || trade,
  };
}

async function queryYellowPages(
  trade: string,
  location: string
): Promise<{ items: DiscoveredBusiness[]; rateLimited: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(
      trade
    )}&geo_location_terms=${encodeURIComponent(location)}`;
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    if (res.status === 403 || res.status === 429) {
      return { items: [], rateLimited: true };
    }
    if (!res.ok) return { items: [], rateLimited: false };

    const html = await res.text();
    const $ = cheerio.load(html);
    const items: DiscoveredBusiness[] = [];

    $('div.result').each((_, el) => {
      const name = $(el).find('a.business-name').first().text().trim();
      const website = $(el).find('a.track-visit-website').first().attr('href') || '';
      const locality = $(el).find('.locality').first().text().trim();
      const categories = $(el)
        .find('.categories a')
        .map((__, a) => $(a).text().trim())
        .get()
        .join(', ');

      if (!name || !website) return;
      const { domain, baseUrl } = normalizeDomain(website);
      if (isBlockedDomain(domain)) return;

      items.push({
        id: crypto.randomUUID(),
        companyName: name,
        domain,
        websiteUrl: baseUrl,
        source: 'YellowPages',
        locality: locality || location,
        categories: categories || trade,
      });
    });

    return { items, rateLimited: false };
  } catch {
    return { items: [], rateLimited: false };
  } finally {
    clearTimeout(timer);
  }
}

async function queryDuckDuckGo(
  trade: string,
  location: string
): Promise<{ items: DiscoveredBusiness[]; rateLimited: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const q = `${trade} in ${location} official website`;
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (res.status === 202 || res.status === 403 || res.status === 429) {
      return { items: [], rateLimited: true };
    }
    if (!res.ok) return { items: [], rateLimited: false };

    const html = await res.text();
    if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo')) {
      return { items: [], rateLimited: true };
    }

    const $ = cheerio.load(html);
    const items: DiscoveredBusiness[] = [];

    $('div.result').each((_, el) => {
      const linkEl = $(el).find('a.result__a').first();
      const rawHref = linkEl.attr('href') || '';
      const unwrapped = unwrapDuckDuckGoUrl(rawHref);
      if (!unwrapped) return;

      const { domain, baseUrl } = normalizeDomain(unwrapped);
      if (isBlockedDomain(domain)) return;

      const rawTitle = linkEl.text().trim();
      const companyName = rawTitle.split(/[|\-–:]/)[0]?.trim() || domain;
      const snippet = $(el).find('.result__snippet').first().text().trim();

      items.push({
        id: crypto.randomUUID(),
        companyName,
        domain,
        websiteUrl: baseUrl,
        source: 'DuckDuckGo',
        locality: location,
        categories: snippet.slice(0, 90) || trade,
      });
    });

    return { items, rateLimited: items.length === 0 };
  } catch {
    return { items: [], rateLimited: false };
  } finally {
    clearTimeout(timer);
  }
}

async function querySerper(
  trade: string,
  location: string,
  apiKey: string
): Promise<DiscoveredBusiness[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `${trade} in ${location}`,
        num: 25,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Serper API returned HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      places?: Array<{ title?: string; website?: string; address?: string; category?: string }>;
    };

    const items: DiscoveredBusiness[] = [];
    for (const place of data.places || []) {
      const entry = buildBusinessFromSearchItem(
        place.website || '',
        place.title || '',
        place.category || '',
        'Serper',
        place.address || location,
        trade
      );
      if (entry) items.push(entry);
    }
    for (const row of data.organic || []) {
      const entry = buildBusinessFromSearchItem(
        row.link || '',
        row.title || '',
        row.snippet || '',
        'Serper',
        location,
        trade
      );
      if (entry) items.push(entry);
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function queryBrave(
  trade: string,
  location: string,
  apiKey: string
): Promise<DiscoveredBusiness[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const q = `${trade} in ${location}`;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20`;
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'X-Subscription-Token': apiKey,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Brave Search API returned HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    const items: DiscoveredBusiness[] = [];
    for (const row of data.web?.results || []) {
      const entry = buildBusinessFromSearchItem(
        row.url || '',
        row.title || '',
        row.description || '',
        'Brave',
        location,
        trade
      );
      if (entry) items.push(entry);
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function queryTavily(
  trade: string,
  location: string,
  apiKey: string
): Promise<DiscoveredBusiness[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${trade} in ${location} official company website`,
        max_results: 20,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Tavily API returned HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const items: DiscoveredBusiness[] = [];
    for (const row of data.results || []) {
      const entry = buildBusinessFromSearchItem(
        row.url || '',
        row.title || '',
        row.content || '',
        'Tavily',
        location,
        trade
      );
      if (entry) items.push(entry);
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function queryCustomSearch(
  trade: string,
  location: string,
  endpoint: string,
  apiKey: string
): Promise<DiscoveredBusiness[]> {
  const cleanEndpoint = endpoint.trim();
  if (!cleanEndpoint) {
    throw new Error('Custom Search Endpoint URL is required.');
  }
  const query = `${trade} in ${location}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
      headers['X-API-KEY'] = apiKey.trim();
    }

    const usesTemplate = cleanEndpoint.includes('{query}') || cleanEndpoint.includes('{q}');
    const targetUrl = usesTemplate
      ? cleanEndpoint
          .replace(/\{query\}/g, encodeURIComponent(query))
          .replace(/\{q\}/g, encodeURIComponent(query))
      : cleanEndpoint;

    const res = await fetch(targetUrl, {
      method: usesTemplate ? 'GET' : 'POST',
      signal: controller.signal,
      headers,
      body: usesTemplate ? undefined : JSON.stringify({ query, q: query, trade, location, limit: 20 }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Custom Search endpoint returned HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }

    const data = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
      organic?: Array<Record<string, unknown>>;
      items?: Array<Record<string, unknown>>;
      data?: Array<Record<string, unknown>>;
      web?: { results?: Array<Record<string, unknown>> };
    };

    const rawRows =
      data.results || data.organic || data.items || data.web?.results || data.data || [];
    const items: DiscoveredBusiness[] = [];
    for (const row of rawRows) {
      const rawUrl = String(row.url || row.link || row.website || '');
      const rawTitle = String(row.title || row.name || row.companyName || '');
      const snippet = String(row.snippet || row.description || row.content || '');
      const entry = buildBusinessFromSearchItem(
        rawUrl,
        rawTitle,
        snippet,
        'Custom Search',
        location,
        trade
      );
      if (entry) items.push(entry);
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverLocalBusinesses(
  trade: string,
  location: string,
  searchConfig?: SearchApiConfig
): Promise<{
  results: DiscoveredBusiness[];
  providerUsed: SearchApiProvider;
  sources: { yellowpages: number; duckduckgo: number; searchApi: number };
  rateLimited: boolean;
}> {
  const provider = searchConfig?.provider || 'builtin_zero_key';
  const apiKey = (searchConfig?.apiKey || '').trim();
  const customEndpoint = (searchConfig?.customEndpoint || '').trim();

  const canUseExternalSearch =
    provider !== 'builtin_zero_key' &&
    ((provider === 'custom' && Boolean(customEndpoint)) || (provider !== 'custom' && Boolean(apiKey)));

  if (canUseExternalSearch) {
    let apiItems: DiscoveredBusiness[] = [];
    if (provider === 'serper') {
      apiItems = await querySerper(trade, location, apiKey);
    } else if (provider === 'brave') {
      apiItems = await queryBrave(trade, location, apiKey);
    } else if (provider === 'tavily') {
      apiItems = await queryTavily(trade, location, apiKey);
    } else if (provider === 'custom') {
      apiItems = await queryCustomSearch(trade, location, customEndpoint, apiKey);
    }

    const seenDomains = new Set<string>();
    const deduped: DiscoveredBusiness[] = [];
    for (const item of apiItems) {
      if (seenDomains.has(item.domain)) continue;
      seenDomains.add(item.domain);
      deduped.push(item);
      if (deduped.length >= 25) break;
    }

    return {
      results: deduped,
      providerUsed: provider,
      sources: {
        yellowpages: 0,
        duckduckgo: 0,
        searchApi: deduped.length,
      },
      rateLimited: false,
    };
  }

  const [yp, ddg] = await Promise.all([
    queryYellowPages(trade, location),
    queryDuckDuckGo(trade, location),
  ]);

  const seenDomains = new Set<string>();
  const merged: DiscoveredBusiness[] = [];

  for (const item of [...ddg.items, ...yp.items]) {
    if (seenDomains.has(item.domain)) continue;
    seenDomains.add(item.domain);
    merged.push(item);
    if (merged.length >= 25) break;
  }

  return {
    results: merged,
    providerUsed: 'builtin_zero_key',
    sources: {
      yellowpages: yp.items.length,
      duckduckgo: ddg.items.length,
      searchApi: 0,
    },
    rateLimited: merged.length === 0 && (yp.rateLimited || ddg.rateLimited),
  };
}
