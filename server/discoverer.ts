import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type {
  DiscoveredBusiness,
  SearchApiConfig,
  SearchApiProvider,
} from '../src/shared/types.ts';
import { normalizeDomain } from './crawler.ts';
import { assertSafePublicUrl } from './security.ts';

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
  'msn.com',
  'microsoft.com',
  'yahoo.com',
  'aol.com',
  'reddit.com',
  'quora.com',
  'pinterest.com',
  'tiktok.com',
  'homeguide.com',
  'bark.com',
  'networx.com',
  'improvenet.com',
  'yellowpages.ca',
  'trustpilot.com',
  'capterra.com',
  'g2.com',
  'bizapedia.com',
  'opencorporates.com',
  'buzzfile.com',
  'dandb.com',
  'kompass.com',
  'thomasnet.com',
  'ziprecruiter.com',
  'monster.com',
  'careerbuilder.com',
  'simplyhired.com',
  // Dictionaries & reference
  'dictionary.com',
  'merriam-webster.com',
  'thefreedictionary.com',
  'vocabulary.com',
  'cambridge.org',
  'oxfordlearnersdictionaries.com',
  'collinsdictionary.com',
  'wiktionary.org',
  'britannica.com',
  'urbandictionary.com',
  'thesaurus.com',
  // Media, clickbait & mega-chains
  'buzzfeed.com',
  'forbes.com',
  'businessinsider.com',
  'huffpost.com',
  'medium.com',
  'substack.com',
  'dollargeneral.com',
  'walmart.com',
  'amazon.com',
  'homedepot.com',
  'lowes.com',
  'menards.com',
  'costco.com',
  'target.com',
  'thegeneral.com',
  // Contractor directories, lead-gen & listicles
  'procore.com',
  'constructioncompanieslist.com',
  'earthworkscout.com',
  'clutch.co',
  'goodfirms.co',
  'upcity.com',
  'sortlist.com',
  'designrush.com',
  'fixr.com',
  'bobvila.com',
  'thisoldhouse.com',
  'familyhandyman.com',
  'thespruce.com',
  'localremodelingquotes.com',
  'modernize.com',
  'craftjack.com',
  'homestars.com',
  'checkatrade.com',
  'trustatrader.com',
  'ratedpeople.com',
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

export function cleanCompanyTitle(rawTitle: string, domain: string): string {
  const withoutPrefix = (rawTitle || '')
    .trim()
    .replace(/^(?:welcome\s+to\s+|home\s*[-–—:|]\s*)+/i, '')
    .trim();
  const segments = withoutPrefix.split(/[|\-–—:]/);
  const firstSegment = segments.map((s) => s.trim()).find(Boolean) || '';
  const cleaned = firstSegment
    .replace(/^(?:welcome\s+to\s+|home\s*[-–—:]\s*)+/i, '')
    .trim();
  return cleaned || domain;
}

export function isJunkOrListicleResult(domain: string, rawTitle: string, rawUrl: string): boolean {
  const url = (rawUrl || '').trim();
  const title = (rawTitle || '').trim();
  const lowerDomain = (domain || '').toLowerCase();

  if (/(?:duckduckgo\.com\/y\.js|bing\.com\/aclick|[?&]ad_domain=|[?&]utm_medium=cpc)/i.test(url)) {
    return true;
  }
  if (
    /(?:companieslist|contractorslist|bestrated|top10|toprated|quotes?|directory|yellowpages|whitepages|superpages)\.[a-z]{2,}$/i.test(
      lowerDomain
    )
  ) {
    return true;
  }
  if (
    /^(?:the\s+)?(?:top|best)\s+\d+\b/i.test(title) ||
    /^\d+\s+(?:best|top)\b/i.test(title) ||
    /\b(?:definition\s*(?:&|and)\s*meaning|english\s+meaning|dictionary|synonyms|thesaurus)\b/i.test(
      title
    ) ||
    /^(?:find|compare|hire|search)\s+(?:the\s+)?(?:best\s+|top\s+)?[a-z\s]+\s+(?:in|near)\b/i.test(
      title
    )
  ) {
    return true;
  }
  return false;
}

export function buildSearchQueries(
  trade: string,
  location: string
): { primary: string; fallback: string } {
  const cleanTrade = (trade || '').trim().replace(/\s+/g, ' ');
  const cleanLocation = (location || '').trim().replace(/\s+/g, ' ');
  const cleanedTrade = cleanTrade.replace(/[&/]+/g, ' ').replace(/\s+/g, ' ').trim();
  const primary = `${cleanedTrade} in ${cleanLocation} official website`.replace(/\s+/g, ' ').trim();

  let fallback = `${cleanedTrade} in ${cleanLocation}`.replace(/\s+/g, ' ').trim();
  if (/[&/,]/.test(cleanTrade)) {
    const firstSeg =
      cleanTrade
        .split(/[&/,]/)[0]
        ?.replace(/\s+/g, ' ')
        .trim() || '';
    if (firstSeg) {
      fallback = `${firstSeg} in ${cleanLocation}`.replace(/\s+/g, ' ').trim();
    }
  }

  return { primary, fallback };
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
  if (isJunkOrListicleResult(domain, rawTitle, rawUrl)) return null;
  const cleanName = cleanCompanyTitle(rawTitle, domain);
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

async function queryDuckDuckGoHtml(
  query: string,
  location: string,
  trade: string
): Promise<{ items: DiscoveredBusiness[]; rateLimited: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://html.duckduckgo.com/',
        Origin: 'https://html.duckduckgo.com',
      },
      body: new URLSearchParams({ q: query, kl: 'us-en' }).toString(),
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
      if ($(el).hasClass('result--ad') || $(el).find('.badge--ad').length > 0) return;
      const linkEl = $(el).find('a.result__a').first();
      const rawHref = linkEl.attr('href') || '';
      if (rawHref.includes('duckduckgo.com/y.js') || rawHref.includes('ad_domain=')) return;
      const unwrapped = unwrapDuckDuckGoUrl(rawHref);
      if (!unwrapped) return;

      const rawTitle = linkEl.text().trim();
      const snippet = $(el).find('.result__snippet').first().text().trim();
      const entry = buildBusinessFromSearchItem(
        unwrapped,
        rawTitle,
        snippet,
        'DuckDuckGo',
        location,
        trade
      );
      if (entry) items.push(entry);
    });

    return { items, rateLimited: false };
  } catch {
    return { items: [], rateLimited: false };
  } finally {
    clearTimeout(timer);
  }
}

async function queryDuckDuckGoLite(
  query: string,
  location: string,
  trade: string
): Promise<{ items: DiscoveredBusiness[]; rateLimited: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://lite.duckduckgo.com/',
      },
      body: new URLSearchParams({ q: query, kl: 'us-en' }).toString(),
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

    $('a.result-link').each((_, el) => {
      const row = $(el).closest('tr');
      if (row.hasClass('result-sponsored')) return;
      const rawHref = $(el).attr('href') || '';
      if (rawHref.includes('duckduckgo.com/y.js') || rawHref.includes('ad_domain=')) return;
      const unwrapped = unwrapDuckDuckGoUrl(rawHref);
      if (!unwrapped) return;

      const rawTitle = $(el).text().trim();
      const snippet =
        row.next('tr').find('.result-snippet').first().text().trim() ||
        row.nextAll('tr').first().find('.result-snippet').first().text().trim() ||
        $(el).parent().find('.result-snippet').first().text().trim() ||
        '';
      const entry = buildBusinessFromSearchItem(
        unwrapped,
        rawTitle,
        snippet,
        'DuckDuckGo',
        location,
        trade
      );
      if (entry) items.push(entry);
    });

    return { items, rateLimited: false };
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

    await assertSafePublicUrl(targetUrl);

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
  fallbackNote?: string;
  queryUsed?: string;
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
      queryUsed: `${trade} in ${location}`,
    };
  }

  let fallbackNote: string | undefined =
    provider !== 'builtin_zero_key'
      ? 'No API key/endpoint set for selected Search API — used Zero-Key Built-in Scraper ($0.00) instead.'
      : undefined;

  const { primary, fallback } = buildSearchQueries(trade, location);
  const [ddgHtml, yp] = await Promise.all([
    queryDuckDuckGoHtml(primary, location, trade),
    queryYellowPages(trade, location),
  ]);

  const seenDomains = new Set<string>();
  const merged: DiscoveredBusiness[] = [];
  const sourceCounts = { duckduckgo: 0, yellowpages: 0 };

  const mergeBatch = (batch: DiscoveredBusiness[]): number => {
    let added = 0;
    for (const item of batch) {
      if (merged.length >= 25) break;
      if (seenDomains.has(item.domain)) continue;
      seenDomains.add(item.domain);
      merged.push(item);
      added++;
      if (item.source === 'DuckDuckGo') sourceCounts.duckduckgo++;
      else if (item.source === 'YellowPages') sourceCounts.yellowpages++;
    }
    return added;
  };

  mergeBatch(ddgHtml.items);
  mergeBatch(yp.items);

  let anyDdgResponded = !ddgHtml.rateLimited;
  let queryUsed = primary;

  if (merged.length < 4 && !ddgHtml.rateLimited) {
    const ddgLite = await queryDuckDuckGoLite(fallback, location, trade);
    const addedFromLite = mergeBatch(ddgLite.items);
    anyDdgResponded = anyDdgResponded || !ddgLite.rateLimited;
    if (addedFromLite > 0) {
      queryUsed = merged.length === addedFromLite ? fallback : `${primary} + ${fallback}`;
      if (!fallbackNote) {
        fallbackNote = `Expanded search using "${fallback}" to find more local businesses.`;
      }
    }
  }

  return {
    results: merged,
    providerUsed: 'builtin_zero_key',
    sources: {
      yellowpages: sourceCounts.yellowpages,
      duckduckgo: sourceCounts.duckduckgo,
      searchApi: 0,
    },
    rateLimited: merged.length === 0 && !anyDdgResponded,
    ...(fallbackNote ? { fallbackNote } : {}),
    queryUsed,
  };
}
