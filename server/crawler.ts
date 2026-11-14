import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import * as cheerio from 'cheerio';
import type { EmailCandidate, EmailPriority, LeadRecord } from '../src/shared/types.ts';

const INTERNAL_LINK_REGEX =
  /(contact|about|team|leadership|staff|people|estimate|bid|connect|office|location|directory)/i;

const GENERIC_TITLE_SEGMENT_REGEX =
  /^(home|homepage|welcome|index|official\s*site|official\s*website|contact|contact\s*us|about|about\s*us|services|projects|main|menu|untitled)$/i;

const SEO_PREPOSITION_REGEX =
  /\b(in|for|serving|near|across|with|your|best|top|leading|premier|trusted|quality|since|offering|providing|and)\b/i;

const ASSET_EXTENSION_REGEX =
  /\.(pdf|png|jpe?g|gif|svg|webp|ico|docx?|xlsx?|pptx?|zip|rar|mp4|mp3|wav|css|js|xml|json)$/i;

const NON_PERSON_TOKENS = new Set([
  'home',
  'about',
  'careers',
  'career',
  'locations',
  'location',
  'services',
  'service',
  'projects',
  'project',
  'process',
  'contact',
  'trade',
  'trades',
  'site',
  'community',
  'work',
  'works',
  'view',
  'more',
  'menu',
  'privacy',
  'terms',
  'copyright',
  'company',
  'overview',
  'history',
  'culture',
  'news',
  'blog',
  'gallery',
  'portfolio',
  'resources',
  'testimonials',
  'reviews',
  'request',
  'quote',
  'estimate',
  'estimating',
  'free',
  'call',
  'email',
  'click',
  'learn',
  'read',
  'welcome',
  'building',
  'construction',
  'engineering',
  'commercial',
  'industrial',
  'residential',
  'group',
  'inc',
  'llc',
  'corp',
  'solutions',
  'systems',
  'partners',
  'associates',
  'our',
  'the',
  'your',
  'get',
  'find',
  'see',
  'all',
  'new',
  'meet',
  'leadership',
  'team',
  'staff',
  'people',
  'office',
  'connect',
  'directory',
  'client',
  'clients',
  'support',
  'municipal',
  'municipality',
  'township',
  'department',
  'authority',
  'commission',
  'association',
  'division',
  'corporate',
]);

const DESK_PREFIXES = new Set([
  'estimating',
  'bids',
  'bidding',
  'projects',
  'project',
  'development',
  'brokerage',
  'engineering',
  'zoning',
  'permits',
  'preconstruction',
  'commercial',
  'proposals',
]);

const GENERIC_PREFIXES = new Set([
  'info',
  'contact',
  'hello',
  'office',
  'admin',
  'sales',
  'support',
  'mail',
  'inquiries',
  'noreply',
  'no-reply',
  'webmaster',
]);

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function normalizeDomain(input: string): { domain: string; baseUrl: string } {
  let clean = input.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//, '').replace(/^www\./, '');
  clean = clean.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  return {
    domain: clean,
    baseUrl: `https://${clean}`,
  };
}

export function formatDomainAsName(domain: string): string {
  const stem = domain.split('.')[0] || domain;
  return stem
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function decodeEntitiesAndObfuscation(input: string): string {
  if (!input) return '';
  let decoded = input
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");

  decoded = decoded
    .replace(/([a-zA-Z0-9._%+-]+)\s*[\[(]\s*at\s*[\])]\s*([a-zA-Z0-9.-]+)/gi, '$1@$2')
    .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+)\s*[\[(]\s*dot\s*[\])]\s*([a-zA-Z]{2,})/gi, '$1.$2');

  return decoded;
}

export function collapseDoubledCompanyName(rawName: string): string {
  const cleaned = rawName.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const delimParts = cleaned.split(/\s*(?:\||–|—|-|\/)\s*/).filter(Boolean);
  if (delimParts.length === 2) {
    const normA = delimParts[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const normB = delimParts[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normA && normA === normB) return delimParts[0].trim();
  }

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    const normFirst = firstHalf.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normSecond = secondHalf.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normFirst && normFirst === normSecond) return firstHalf;
  }

  const repeatMatch = cleaned.match(/^(.{3,}?)\s+\1$/i);
  if (repeatMatch) return repeatMatch[1].trim();

  return cleaned;
}

export function sanitizeExtractedEmail(rawEmail: string): string {
  let cleaned = decodeEntitiesAndObfuscation(rawEmail)
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .trim()
    .toLowerCase();

  // Strip glued phone numbers / 7-digit or 10-digit prefixes like 435-0678info@domain.com
  cleaned = cleaned.replace(
    /^(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.]?\d{4}[-.\s]*(?=[a-z])/i,
    ''
  );
  return cleaned;
}

export function classifyEmailPriority(email: string): {
  priority: EmailPriority;
  reason: string;
} {
  const localPart = email.split('@')[0]?.toLowerCase() || '';
  if (GENERIC_PREFIXES.has(localPart)) {
    return { priority: 'generic', reason: 'Generic inbox fallback' };
  }
  if (DESK_PREFIXES.has(localPart)) {
    return { priority: 'desk', reason: 'Project / estimating desk' };
  }
  return { priority: 'named', reason: 'Named decision-maker / personal inbox' };
}

export function isValidEmailSyntax(email: string): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  const lower = email.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|eot|ttf)$/.test(lower)) return false;
  if (
    lower.includes('example.com') ||
    lower.includes('sentry.io') ||
    lower.includes('wixpress') ||
    lower.includes('yourdomain.') ||
    lower.includes('email.com')
  ) {
    return false;
  }
  return true;
}

export function sortEmailCandidates(candidates: EmailCandidate[]): EmailCandidate[] {
  const rank: Record<EmailPriority, number> = { named: 0, desk: 1, generic: 2 };
  return [...candidates].sort((a, b) => {
    if (a.mxValid !== b.mxValid) return a.mxValid ? -1 : 1;
    return rank[a.priority] - rank[b.priority];
  });
}

export async function checkMxRecord(domain: string): Promise<{ mxValid: boolean; mxHost?: string }> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MX timeout')), 3000)),
    ]);
    if (Array.isArray(records) && records.length > 0) {
      const sorted = [...records].sort((a, b) => a.priority - b.priority);
      return { mxValid: true, mxHost: sorted[0].exchange };
    }
    return { mxValid: false };
  } catch {
    return { mxValid: false };
  }
}

async function fetchHtmlPage(
  url: string
): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml')
    ) {
      return null;
    }
    const html = await res.text();
    if (!html || html.trim().length < 40) return null;
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRootWithFallbacks(
  domain: string
): Promise<{ html: string; finalUrl: string; usedWwwFallback: boolean } | null> {
  const candidates = [
    { url: `https://${domain}/`, www: false },
    { url: `https://www.${domain}/`, www: true },
    { url: `http://${domain}/`, www: false },
    { url: `http://www.${domain}/`, www: true },
  ];

  for (const candidate of candidates) {
    const fetched = await fetchHtmlPage(candidate.url);
    if (fetched) {
      return {
        html: fetched.html,
        finalUrl: fetched.finalUrl,
        usedWwwFallback: candidate.www || fetched.finalUrl.includes('://www.'),
      };
    }
  }
  return null;
}

function discoverInternalLinks(html: string, rootUrlStr: string): string[] {
  const $ = cheerio.load(html);
  let rootUrl: URL;
  try {
    rootUrl = new URL(rootUrlStr);
  } catch {
    return [];
  }

  const rootBareHost = rootUrl.hostname.replace(/^www\./, '').toLowerCase();
  const scored = new Map<string, { url: string; score: number }>();

  $('a[href]').each((_, el) => {
    const rawHref = ($(el).attr('href') || '').trim();
    if (
      !rawHref ||
      rawHref.startsWith('#') ||
      rawHref.startsWith('mailto:') ||
      rawHref.startsWith('tel:') ||
      rawHref.startsWith('javascript:')
    ) {
      return;
    }

    let resolved: URL;
    try {
      resolved = new URL(rawHref, rootUrl.origin);
    } catch {
      return;
    }

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    const linkBareHost = resolved.hostname.replace(/^www\./, '').toLowerCase();
    if (linkBareHost !== rootBareHost) return;
    if (ASSET_EXTENSION_REGEX.test(resolved.pathname)) return;

    const cleanPath = resolved.pathname.replace(/\/+$/, '') || '/';
    if (cleanPath === '/' || cleanPath === rootUrl.pathname.replace(/\/+$/, '')) return;

    const anchorText = $(el).text().replace(/\s+/g, ' ').trim();
    const combinedSignal = `${cleanPath} ${anchorText}`;
    if (!INTERNAL_LINK_REGEX.test(combinedSignal)) return;

    let score = 1;
    if (/contact|connect/i.test(combinedSignal)) score += 5;
    if (/team|leadership|staff|people/i.test(combinedSignal)) score += 4;
    if (/estimate|bid/i.test(combinedSignal)) score += 4;
    if (/about/i.test(combinedSignal)) score += 3;
    if (/office|location|directory/i.test(combinedSignal)) score += 2;
    if (cleanPath.split('/').filter(Boolean).length <= 2) score += 1;

    const canonicalUrl = `${resolved.origin}${cleanPath}`;
    const prev = scored.get(canonicalUrl);
    if (!prev || score > prev.score) {
      scored.set(canonicalUrl, { url: canonicalUrl, score });
    }
  });

  const prioritized = Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url)
    .slice(0, 5);

  if (prioritized.length < 2) {
    for (const fallbackPath of ['/contact', '/about']) {
      const candidate = `${rootUrl.origin}${fallbackPath}`;
      if (!prioritized.includes(candidate) && prioritized.length < 5) {
        prioritized.push(candidate);
      }
    }
  }

  return prioritized;
}

interface JsonLdSignals {
  orgNames: string[];
  emails: string[];
  phones: string[];
  personNames: string[];
}

function parseJsonLd($: cheerio.CheerioAPI): JsonLdSignals {
  const orgNames: string[] = [];
  const emails: string[] = [];
  const phones: string[] = [];
  const personNames: string[] = [];

  const orgTypeRegex =
    /(Organization|LocalBusiness|Corporation|ProfessionalService|GeneralContractor|Attorney|LegalService|RealEstateAgent)/i;

  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const rawType = Array.isArray(obj['@type'])
      ? obj['@type'].join(' ')
      : String(obj['@type'] || '');

    if (orgTypeRegex.test(rawType) && typeof obj.name === 'string') {
      const n = decodeEntitiesAndObfuscation(obj.name).trim();
      if (n && !GENERIC_TITLE_SEGMENT_REGEX.test(n)) {
        orgNames.push(n);
      }
    }

    if (/Person/i.test(rawType) && typeof obj.name === 'string') {
      const pn = decodeEntitiesAndObfuscation(obj.name).trim();
      if (isLikelyHumanName(pn)) personNames.push(pn);
    }

    if (typeof obj.email === 'string') {
      const cleaned = sanitizeExtractedEmail(obj.email);
      if (isValidEmailSyntax(cleaned)) emails.push(cleaned);
    }

    if (typeof obj.telephone === 'string') {
      const ph = obj.telephone.trim();
      if (ph) phones.push(ph);
    }

    for (const personKey of ['founder', 'founders', 'employee', 'member']) {
      if (obj[personKey]) visit(obj[personKey]);
    }

    if (obj.contactPoint) visit(obj.contactPoint);
    if (obj['@graph']) visit(obj['@graph']);
    if (obj.mainEntity) visit(obj.mainEntity);
    if (obj.publisher) visit(obj.publisher);
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  });

  return {
    orgNames: Array.from(new Set(orgNames)),
    emails: Array.from(new Set(emails)),
    phones: Array.from(new Set(phones)),
    personNames: Array.from(new Set(personNames)),
  };
}

function isLikelyHumanName(rawName: string): boolean {
  const cleaned = rawName.replace(/,\s*(PE|Esq\.?|AIA|CPA|PhD|LEED\s*AP)$/i, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;

  for (const w of words) {
    if (NON_PERSON_TOKENS.has(w.toLowerCase().replace(/[^a-z]/g, ''))) {
      return false;
    }
    if (!/^[A-Z][a-zA-Z.'-]{1,18}$/.test(w)) {
      return false;
    }
  }
  return true;
}

function resolveCompanyName(
  $: cheerio.CheerioAPI,
  domain: string,
  jsonLdOrgNames: string[]
): string {
  // 1. JSON-LD Organization / LocalBusiness name
  if (jsonLdOrgNames.length > 0 && jsonLdOrgNames[0].length >= 2) {
    return collapseDoubledCompanyName(jsonLdOrgNames[0]);
  }

  // 2. <meta property="og:site_name">
  const ogSiteName = decodeEntitiesAndObfuscation(
    $('meta[property="og:site_name"]').attr('content') ||
      $('meta[name="application-name"]').attr('content') ||
      ''
  ).trim();
  if (ogSiteName && !GENERIC_TITLE_SEGMENT_REGEX.test(ogSiteName) && ogSiteName.split(/\s+/).length <= 6) {
    return collapseDoubledCompanyName(ogSiteName);
  }

  // 3. <title> delimiter split & SEO tagline pruning
  const rawTitle = decodeEntitiesAndObfuscation($('title').text()).trim();
  if (rawTitle) {
    const domainStem = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const segments = rawTitle
      .split(/\s*(?:\||–|—|:|•|\s-\s|\/)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    const validSegments = segments.filter((seg) => {
      if (GENERIC_TITLE_SEGMENT_REGEX.test(seg)) return false;
      const words = seg.split(/\s+/).filter(Boolean);
      if (words.length > 6) return false;
      if (words.length > 4 && SEO_PREPOSITION_REGEX.test(seg)) return false;
      return true;
    });

    if (validSegments.length > 0) {
      const brandMatch = validSegments.find((seg) => {
        const norm = seg.toLowerCase().replace(/[^a-z0-9]/g, '');
        return domainStem.length >= 4 && norm.includes(domainStem.slice(0, 5));
      });
      const chosen = brandMatch || validSegments[0];
      if (chosen.split(/\s+/).length > 1 || !NON_PERSON_TOKENS.has(chosen.toLowerCase())) {
        return collapseDoubledCompanyName(chosen);
      }
    }
  }

  // 4. Clean domain stem fallback
  return formatDomainAsName(domain);
}

function extractPageSignals(html: string, domain: string) {
  const spacedHtml = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(
      /<\/(?:p|div|span|li|td|th|a|h[1-6]|address|section|article|label|strong|em|b|i|small|tr)>/gi,
      '$& '
    );
  const $ = cheerio.load(spacedHtml);
  const jsonLd = parseJsonLd($);
  const companyName = resolveCompanyName($, domain, jsonLd.orgNames);
  const metaDesc = decodeEntitiesAndObfuscation(
    $('meta[name="description"]').attr('content') || ''
  ).trim();

  // Extract mailto: and tel: links across entire page (including footer!)
  const mailtoEmails: string[] = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const cleaned = sanitizeExtractedEmail($(el).attr('href') || '');
    if (isValidEmailSyntax(cleaned)) mailtoEmails.push(cleaned);
  });

  const telPhones: string[] = [];
  $('a[href^="tel:"]').each((_, el) => {
    const raw = ($(el).attr('href') || '').replace(/^tel:/i, '').trim();
    if (raw.length >= 7) telPhones.push(raw);
  });

  // Explicitly capture footer text for emails/phones before stripping nav/footer
  const footerText = decodeEntitiesAndObfuscation($('footer').text().replace(/\s+/g, ' ').trim());

  $('script, style, noscript, svg, iframe').remove();
  const fullBodyText = decodeEntitiesAndObfuscation($('body').text().replace(/\s+/g, ' ').trim());

  const combinedForContacts = `${fullBodyText} ${footerText}`;
  const regexEmails = (
    combinedForContacts.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
  )
    .map((e) => sanitizeExtractedEmail(e))
    .filter(isValidEmailSyntax);

  const regexPhones =
    combinedForContacts.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || [];
  const phones = Array.from(new Set([...jsonLd.phones, ...telPhones, ...regexPhones])).slice(0, 6);

  // Clone body and strip nav/header/footer menu chrome before leadership name scanning
  const cleanDom = cheerio.load($.html());
  cleanDom('nav, header, footer, [role="navigation"], .nav, .navbar, .menu, .breadcrumbs').remove();
  const contentText = decodeEntitiesAndObfuscation(
    cleanDom('body').text().replace(/\s+/g, ' ').trim()
  );

  const leadershipNames: string[] = [...jsonLd.personNames];
  const roleRegex =
    /\b([A-Z][a-z]{1,16}(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]{1,18})(?:,\s*(?:PE|Esq\.?|AIA|CPA|LEED\s*AP))?\s*(?:[-–|,•:]|\bis\b|\bas\b)?\s*(?:President|Vice President|VP|CEO|CFO|COO|CTO|Owner|Co-Founder|Founder|Partner|Principal|Director|Manager|Chief Estimator|Estimator|Engineer|Superintendent|Project Manager)\b/g;
  let match: RegExpExecArray | null;
  while ((match = roleRegex.exec(contentText)) !== null) {
    const candidate = match[1]?.trim() || '';
    if (candidate && isLikelyHumanName(candidate) && !leadershipNames.includes(candidate)) {
      leadershipNames.push(candidate);
    }
  }

  return {
    companyName,
    metaDesc,
    visibleText: fullBodyText,
    emails: Array.from(new Set([...jsonLd.emails, ...mailtoEmails, ...regexEmails])),
    phones,
    leadershipNames: leadershipNames.slice(0, 8),
  };
}

export async function crawlTargetDomain(
  rawUrl: string,
  options?: { preferredCompanyName?: string }
): Promise<LeadRecord> {
  const { domain, baseUrl } = normalizeDomain(rawUrl);

  if (!domain || !domain.includes('.')) {
    throw new Error(`Invalid domain or URL: "${rawUrl}"`);
  }

  const preferredName = options?.preferredCompanyName
    ? collapseDoubledCompanyName(options.preferredCompanyName)
    : '';

  // Always check root-domain MX records in parallel with root HTTP fetch (with www. fallback)
  const [rootMx, rootFetch] = await Promise.all([
    checkMxRecord(domain),
    fetchRootWithFallbacks(domain),
  ]);

  if (!rootFetch) {
    // Guaranteed Row Persistence even when HTTP is blocked/timed out (zero fabricated emails)
    const now = new Date().toISOString();
    const resolvedName = preferredName || formatDomainAsName(domain);
    return {
      id: crypto.randomUUID(),
      domain,
      inputUrl: rawUrl || baseUrl,
      status: 'crawled',
      crawlMode: 'blocked',
      crawlNote: rootMx.mxValid
        ? 'HTTP Blocked (MX Checked) — automated request blocked or timed out; 0 emails scraped'
        : 'HTTP Blocked (MX Checked) — automated request blocked/timed out and no root MX records found',
      pagesCrawled: [],
      rawText: `${resolvedName} (${domain}) — HTTP Blocked (MX Checked). Website blocked automated HTTP fetch or timed out.`,
      discoveredEmails: [],
      phones: [],
      leadershipNames: [],
      companyName: resolvedName,
      tradeSpecialty: '',
      primaryContactName: 'Primary Contact',
      recommendedEmail: '',
      detectedWorkflow: '',
      civicTrigger: '',
      threadStrategy: 'new_standalone',
      threadId: '',
      threadMessageCount: 0,
      inReplyToMessageId: '',
      subjectLine: '',
      plainTextBody: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  // Discover up to 5 internal contact/about/team/estimating links from the root page
  const internalUrls = discoverInternalLinks(rootFetch.html, rootFetch.finalUrl);
  const subPageResults = await Promise.all(
    internalUrls.map(async (targetUrl) => {
      const fetched = await fetchHtmlPage(targetUrl);
      if (!fetched) return null;
      const pathname = new URL(fetched.finalUrl).pathname || '/';
      return {
        url: fetched.finalUrl,
        path: pathname,
        signals: extractPageSignals(fetched.html, domain),
      };
    })
  );

  const rootPathname = new URL(rootFetch.finalUrl).pathname || '/';
  const rawSucceeded = [
    {
      url: rootFetch.finalUrl,
      path: rootPathname,
      signals: extractPageSignals(rootFetch.html, domain),
    },
    ...subPageResults.filter((r): r is NonNullable<typeof r> => r !== null),
  ];
  const seenUrls = new Set<string>();
  const succeeded = rawSucceeded.filter((page) => {
    if (seenUrls.has(page.url)) return false;
    seenUrls.add(page.url);
    return true;
  });

  const emailSourceMap = new Map<string, string>();
  const phonesSet = new Set<string>();
  const namesSet = new Set<string>();
  const textParts: string[] = [];

  for (const page of succeeded) {
    if (page.signals.metaDesc) textParts.push(`[${page.path}] Summary: ${page.signals.metaDesc}`);
    textParts.push(`[${page.path}] ${page.signals.visibleText.slice(0, 2600)}`);
    for (const email of page.signals.emails) {
      if (!emailSourceMap.has(email)) emailSourceMap.set(email, page.url);
    }
    page.signals.phones.forEach((ph) => phonesSet.add(ph));
    page.signals.leadershipNames.forEach((n) => namesSet.add(n));
  }

  // Check MX for any external email domains discovered (up to 4) + root domain
  const mxMap = new Map<string, { mxValid: boolean; mxHost?: string }>();
  mxMap.set(domain, rootMx);
  const extraDomains = Array.from(
    new Set(
      Array.from(emailSourceMap.keys())
        .map((e) => e.split('@')[1])
        .filter((d): d is string => Boolean(d) && d !== domain)
    )
  ).slice(0, 4);

  await Promise.all(
    extraDomains.map(async (d) => {
      mxMap.set(d, await checkMxRecord(d));
    })
  );

  const discoveredEmails: EmailCandidate[] = sortEmailCandidates(
    Array.from(emailSourceMap.entries()).map(([email, source]) => {
      const ed = email.split('@')[1] || domain;
      const mxInfo = mxMap.get(ed) || rootMx;
      const { priority, reason } = classifyEmailPriority(email);
      return {
        email,
        priority,
        source,
        syntaxValid: isValidEmailSyntax(email),
        mxValid: mxInfo.mxValid,
        mxHost: mxInfo.mxHost,
        reason,
      };
    })
  );

  const leadershipNames = Array.from(namesSet);
  const resolvedCompanyName =
    preferredName || succeeded[0].signals.companyName || formatDomainAsName(domain);
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    domain,
    inputUrl: rawUrl,
    status: 'crawled',
    crawlMode: 'live',
    crawlNote: rootFetch.usedWwwFallback ? 'Resolved via www. fallback' : undefined,
    pagesCrawled: succeeded.map((s) => s.url),
    rawText: textParts.join('\n\n').slice(0, 12000),
    discoveredEmails,
    phones: Array.from(phonesSet),
    leadershipNames,
    companyName: resolvedCompanyName,
    tradeSpecialty: '',
    primaryContactName: leadershipNames[0] || 'Primary Contact',
    recommendedEmail: discoveredEmails[0]?.email || '',
    detectedWorkflow: '',
    civicTrigger: '',
    threadStrategy: 'new_standalone',
    threadId: '',
    threadMessageCount: 0,
    inReplyToMessageId: '',
    subjectLine: '',
    plainTextBody: '',
    createdAt: now,
    updatedAt: now,
  };
}
