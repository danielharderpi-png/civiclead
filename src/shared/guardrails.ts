import type { LeadRecord, ProductProfile, ThreadStrategy } from './types.ts';

export interface GuardrailCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface DeliverabilityReport {
  passed: boolean;
  wordCount: number;
  linkCount: number;
  detectedLinks: string[];
  spamHits: string[];
  checks: GuardrailCheck[];
}

const SPAM_PHRASES = [
  'free trial!',
  'act now',
  'guaranteed',
  'limited time',
  'buy now',
  'click here',
  'risk free',
  'risk-free',
  'urgent',
  'exclusive deal',
  'double your',
  '100% free',
  'no obligation',
  'unlocks',
  'streamline',
  'leverage',
  'game-changer',
];

export function evaluateDeliverability(
  subjectLine: string,
  plainTextBody: string,
  maxLinks = 1
): DeliverabilityReport {
  const combined = `${subjectLine}\n${plainTextBody}`;
  const trimmedBody = plainTextBody.trim();

  // 1. Plain-text check (0 HTML tags / 0 markdown bold/links/headings)
  const hasHtml = /<\/?[a-z][\s\S]*?>/i.test(combined);
  const hasMarkdownBoldOrLink =
    /\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)]+\)|^#{1,6}\s/m.test(combined);
  const plainTextOnly = !hasHtml && !hasMarkdownBoldOrLink;

  // 2. Link count check (<= maxLinks)
  const urlMatches =
    combined.match(
      /(?:https?:\/\/[^\s)]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|gov|us|biz)(?:\/[^\s]*)?)/gi
    ) || [];
  // Filter out email addresses like name@domain.com
  const detectedLinks = urlMatches.filter((match) => {
    const idx = combined.indexOf(match);
    if (idx > 0 && combined[idx - 1] === '@') {
      return false;
    }
    // Check every occurrence to ensure it's not part of an email address
    const emailPattern = new RegExp(`[a-z0-9._%+-]+@${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (emailPattern.test(combined)) {
      const stripped = combined.replace(emailPattern, '');
      return stripped.toLowerCase().includes(match.toLowerCase());
    }
    return true;
  });
  const uniqueLinks = Array.from(new Set(detectedLinks.map((l) => l.toLowerCase())));
  const linkCount = uniqueLinks.length;
  const linkCountOk = linkCount <= maxLinks;

  // 3. Word count check (40-175 words allowed, ~80-150 conversational target)
  const words = trimmedBody ? trimmedBody.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const wordCountOk = wordCount >= 40 && wordCount <= 175;

  // 4. Spam trigger check
  const lower = combined.toLowerCase();
  const spamHits = SPAM_PHRASES.filter((phrase) => lower.includes(phrase));
  if (/\b\d{1,3}%\s*off\s*!/i.test(combined)) {
    spamHits.push('hyped % off!');
  }
  const exclamationCount = (combined.match(/!/g) || []).length;
  if (exclamationCount > 1) {
    spamHits.push(`${exclamationCount} exclamation marks`);
  }
  const zeroSpamTriggers = spamHits.length === 0;

  const checks: GuardrailCheck[] = [
    {
      id: 'plain_text',
      label: 'Plain-text only',
      passed: plainTextOnly,
      detail: plainTextOnly
        ? '0 HTML tags · 0 markdown'
        : hasHtml
          ? 'HTML tags detected'
          : 'Markdown syntax detected',
    },
    {
      id: 'link_cap',
      label: `Links <= ${maxLinks}`,
      passed: linkCountOk,
      detail: `${linkCount} / ${maxLinks} bare URL${maxLinks === 1 ? '' : 's'}`,
    },
    {
      id: 'word_count',
      label: 'Concise length (<= 175 words)',
      passed: wordCountOk,
      detail:
        wordCount === 0
          ? '0 words'
          : wordCount < 40
            ? `${wordCount} words (too brief)`
            : wordCount > 175
              ? `${wordCount} words (trim under 175)`
              : `${wordCount} words (conversational length)`,
    },
    {
      id: 'spam_triggers',
      label: 'Zero spam/ad triggers',
      passed: zeroSpamTriggers,
      detail: zeroSpamTriggers ? 'Clean peer-to-peer copy' : `Flagged: ${spamHits.join(', ')}`,
    },
  ];

  return {
    passed: checks.every((c) => c.passed),
    wordCount,
    linkCount,
    detectedLinks: uniqueLinks,
    spamHits,
    checks,
  };
}

export interface EnrichedPayloadItem {
  domain: string;
  companyName: string;
  tradeSpecialty: string;
  primaryContactName: string;
  recommendedEmail: string;
  detectedWorkflow: string;
  civicTrigger: string;
  isTargetFit?: boolean;
  fitWarning?: string;
  threadStrategy: ThreadStrategy;
  subjectLine: string;
  plainTextBody: string;
}

const NON_TARGET_PHRASE_RE =
  /\b(not a contractor|not a target|non-target|outside target|wrong industry|not a fit|not an? [a-z]+ contractor|501\s*\(\s*c\s*\)\s*\(\s*3\s*\)|youth nonprofit|youth center|nonprofit organization|non-profit organization|charity|church|ministry|elementary school|high school|public school|school district)\b/i;

export function detectNonTargetIndustryWarning(
  lead: Pick<LeadRecord, 'isTargetFit' | 'fitWarning' | 'tradeSpecialty' | 'detectedWorkflow' | 'civicTrigger'>,
  profile: Pick<ProductProfile, 'targetTrades'>
): string | null {
  if (lead.fitWarning && lead.fitWarning.trim()) {
    return lead.fitWarning.trim();
  }
  if (lead.isTargetFit === false) {
    return lead.tradeSpecialty
      ? `${lead.tradeSpecialty} — flagged outside configured target industries`
      : 'Flagged outside configured target industries';
  }
  const combined = `${lead.tradeSpecialty || ''} ${lead.detectedWorkflow || ''} ${lead.civicTrigger || ''}`;
  const match = combined.match(NON_TARGET_PHRASE_RE);
  if (!match) return null;

  const targetStr = (profile.targetTrades || []).join(' ').toLowerCase();
  if (targetStr.includes(match[0].toLowerCase())) {
    return null;
  }

  return lead.tradeSpecialty && NON_TARGET_PHRASE_RE.test(lead.tradeSpecialty)
    ? lead.tradeSpecialty
    : `Detected non-target organization (${match[0]})`;
}

export function buildSystemInstructions(profile: ProductProfile): string {
  const businessName = profile.businessName.trim();
  const websiteUrl = profile.websiteUrl.trim();
  const senderName = profile.senderName.trim();
  const senderEmail = profile.senderEmail.trim();
  const senderContext = profile.senderContext.trim();
  const valueProp = profile.valueProp.trim();
  const targetTrades = profile.targetTrades.map((t) => t.trim()).filter(Boolean);
  const standardOffer = profile.standardOffer.trim();
  const promoCode = profile.promoCode.trim();
  const promoBenefit = profile.promoBenefit.trim();
  const valueSnippet = profile.valueSnippet.trim();
  const callToAction = profile.callToAction.trim();

  const contextLines: string[] = [
    'You are an experienced founder/operator writing real, thoughtful, one-to-one plain-text emails to local or B2B businesses—NOT a copywriter, NOT a template engine, and NOT a bot summarizing a scraped webpage.',
    '',
    'SENDER & OFFER FACTS (USE ONLY NON-EMPTY FACTS BELOW; REPHRASE INTO NATURAL CONVERSATIONAL ENGLISH—NEVER COPY-PASTE LIKE A FORM):',
    `Sender Name & Title: ${senderName}`,
    `Business / Product Name: ${businessName}`,
  ];

  if (senderEmail) {
    contextLines.push(`Sender Email: ${senderEmail}`);
  }
  if (websiteUrl) {
    contextLines.push(`Website URL: ${websiteUrl}`);
  }
  if (senderContext) {
    contextLines.push(`Who the Sender Is / Credibility Context: ${senderContext}`);
  }
  if (valueProp) {
    contextLines.push(`What It Does / Problem Solved: ${valueProp}`);
  }
  if (targetTrades.length > 0) {
    contextLines.push(`Typical Customer Types: ${targetTrades.join(', ')}`);
  }
  if (standardOffer) {
    contextLines.push(`Offer / Trial Terms: ${standardOffer}`);
  }
  if (promoCode) {
    contextLines.push(`Promo Code: ${promoCode}`);
    if (promoBenefit) {
      contextLines.push(`Exact Promo Meaning: ${promoBenefit}`);
    }
  } else if (promoBenefit) {
    contextLines.push(`Offer Detail: ${promoBenefit}`);
  }
  if (valueSnippet) {
    contextLines.push(`Specific Proof / Concrete Detail: ${valueSnippet}`);
  }
  if (callToAction) {
    contextLines.push(`Desired Closing Question / Ask: ${callToAction}`);
  }

  const hasOfferOrPromo = Boolean(standardOffer || promoCode || promoBenefit);

  const ruleLines: string[] = [
    '',
    'CRITICAL WRITING RULES (FOLLOW EVERY SINGLE ONE):',
    '1. SOUND LIKE A REAL HUMAN WRITING IN GMAIL — NEVER LIKE AN AI OR A BROCHURE:',
    '   - Write in first-person singular ("I", "my") as a peer reaching out directly. Never use stiff corporate "we/our" marketing talk.',
    '   - NEVER copy-paste the same identical Paragraph 2 or Paragraph 3 across multiple leads in a batch. Tailor the framing, phrasing, and transition in every email so each message genuinely fits THAT specific company.',
    '   - Rephrase the SENDER & OFFER FACTS above into natural spoken English—never string raw field labels or comma-separated title fragments together (e.g., NEVER write "I\'m Jane Doe, Founder, a solo developer..."; instead introduce naturally in the body like "I\'m Jane..." and save full name + title for the sign-off block).',
    '   - BANNED PHRASES & PATTERNS: Never use "unlocks", "streamline", "leverage", "game-changer", "synergy", "elevate", "free trial!", "act now", "guaranteed", "limited time", "exclusive deal", "no obligation", bullet lists, markdown bold (**), HTML tags, emojis, or multiple exclamation marks.',
    '',
    '2. NEVER REVEAL WEB SCRAPING OR MISSING WEBSITE DATA:',
    '   - NEVER mention crawling, scraping, website errors, or loading issues in subjectLine or plainTextBody. NEVER write things like "your site wouldn\'t load", "not much loaded from your site", "from browsing your website", or "your homepage says".',
    '   - When website text is rich: speak casually as someone already familiar with their reputation, specialties, service area, or recent projects (without stating the obvious back to them—never write condescending lines like "You install X; X needs Y"). Connect *their specific type of work* to the real-world timing/workflow challenge the sender\'s product helps with.',
    '   - When crawlStatus indicates the site was unreachable or minimal text was captured: infer their likely day-to-day workflow from their company name, domain, and target industry, and write a grounded, respectful industry-relevant note as if you found them in a local directory or referrals—never mention that you could not view their site.',
    '',
    '3. EMAIL STRUCTURE, GREETING, LINK PLACEMENT & SIGN-OFF (80–150 WORDS TOTAL):',
    '   - Greeting: Start with a real, brief greeting on its own line. Use their first name if primaryContactName is an actual person\'s name (e.g., "Hi Sarah,"). If no individual name is available ("Primary Contact"), use a warm, normal opener like "Hi there," or "Hi [Company Short Name] team,".',
    '   - Opening (1–2 sentences): Show genuine relevance right away—connect what *they* specifically do (projects, service region, trade niche) to why the sender is reaching out now.',
    `   - Middle (2–3 sentences): Naturally introduce yourself and ${businessName}${senderContext ? ` (working in ${senderContext})` : ''}, and explain in concrete, plain-spoken terms how it actually helps a team like theirs.${valueSnippet ? ' Work in the specific concrete detail naturally where it strengthens the point—do not bolt it onto the end.' : ''}`,
    hasOfferOrPromo
      ? `   - Offer & Close (1–2 sentences): Mention the exact configured offer/promo (${[standardOffer && 'Offer / Trial Terms', promoCode && 'Promo Code + Exact Promo Meaning'].filter(Boolean).join(' and ')}) casually—low pressure, zero hype—and wrap up naturally with ${callToAction ? `the spirit of the Desired Closing Question ("${callToAction}")` : 'a brief, low-friction question asking if it would be useful for their crew'}.`
      : `   - Close (1 sentence): Wrap up with ${callToAction ? `the spirit of the Desired Closing Question ("${callToAction}")` : 'a relaxed, low-friction question asking if something like this would actually be useful for their team'}.`,
    `   - Sign-off: End cleanly on separate lines (e.g., "Best,\\n[Sender Name]\\n[Title / Business Name if applicable]") parsed naturally from "${senderName}".`,
    '   - Link hygiene: Never tack a raw URL awkwardly onto the end of an unrelated sentence like "...packets. https://example.com". Either place the bare URL on its own clean short sentence/line (e.g., "You can check it out here: https://example.com") or omit it cleanly.',
    '',
    '4. STRICT ZERO-HALLUCINATION & ACCURACY RULES:',
    '   - ONLY state trial lengths, discounts, promo codes, geographic coverage, or capabilities explicitly supported by SENDER & OFFER FACTS above. Omit any optional field that was not provided.',
    '   - NEVER invent or guess email addresses: set recommendedEmail ONLY to an address from discoveredEmails, or "" if discoveredEmails is empty.',
    '   - Check Target Fit: if the company clearly does not match Typical Customer Types (e.g., a nonprofit, school, church, or unrelated consumer business when targeting contractors), set isTargetFit to false and explain briefly in fitWarning (otherwise isTargetFit: true, fitWarning: "").',
    '   - In "detectedWorkflow" and "civicTrigger", keep internal analysis strictly honest and factual (if crawl text was unavailable, note "Inferred from company name/domain; verify site manually" inside detectedWorkflow/civicTrigger—while keeping plainTextBody 100% natural and free of scraping mentions).',
    '   - Set threadStrategy to "reply_existing" ONLY when existingThreadDetected is true, otherwise "new_standalone".',
    '   - subjectLine must be short (3–7 words), lowercase or natural sentence case, specific to their trade/area or question, and completely free of hype or punctuation tricks.',
  ];

  if (websiteUrl && profile.maxLinks > 0) {
    ruleLines.push(
      `   - Include at most ${profile.maxLinks} bare URL (${websiteUrl}) in plainTextBody. Never invent URLs not listed above.`
    );
  } else {
    ruleLines.push(
      '   - Include 0 URLs unless a verified Website URL was supplied above; never invent URLs.'
    );
  }

  return [...contextLines, ...ruleLines].join('\n');
}

export function buildBatchPrompt(leads: LeadRecord[], profile: ProductProfile): string {
  const instructions = buildSystemInstructions(profile);
  const senderName = profile.senderName.trim();
  const compactLeads = leads.map((lead) => {
    const cleanText = (lead.rawText || '').trim();
    const crawlStatus =
      lead.crawlMode === 'blocked'
        ? 'website_unreachable_infer_from_company_and_domain'
        : cleanText.length < 100
          ? 'minimal_site_text_infer_from_company_and_domain'
          : 'live_site_text_available';
    return {
      domain: lead.domain,
      companyName: lead.companyName,
      knownTradeSpecialty: lead.tradeSpecialty || null,
      crawlStatus,
      discoveredEmails: lead.discoveredEmails.map((e) => `${e.email} (${e.priority})`),
      leadershipNames: lead.leadershipNames,
      existingThreadDetected: lead.threadMessageCount > 0,
      existingThreadId: lead.threadId || null,
      crawledTextExcerpt: cleanText.slice(0, 4500),
    };
  });

  return `${instructions}

TASK:
Analyze each company below and return ONLY a valid JSON array matching this exact schema (no markdown commentary outside the JSON). Make every email sound distinct, grounded, and genuinely written one-to-one by a real human—never repeat identical paragraph templates across companies:
[
  {
    "domain": "companydomain.com",
    "companyName": "Official Business Name",
    "tradeSpecialty": "Primary Industry or Customer Segment",
    "primaryContactName": "Best person found or 'Primary Contact'",
    "recommendedEmail": "Exact email from discoveredEmails, or '' if none found (NEVER invent emails)",
    "detectedWorkflow": "1-2 sentences summarizing exact services/projects found on their site (or clearly note if inferred from name/domain)",
    "civicTrigger": "Specific operational timing/workflow connection between their work and the configured Product Profile",
    "isTargetFit": true,
    "fitWarning": "If isTargetFit is false, brief reason (e.g. 'Youth nonprofit 501(c)(3), not a contractor'); otherwise ''",
    "threadStrategy": "new_standalone or reply_existing",
    "subjectLine": "short, natural, peer-to-peer subject line (3-7 words)",
    "plainTextBody": "80-150 word natural 100% plain-text email with greeting, 2-3 cohesive short paragraphs, and clean multi-line sign-off from ${senderName}"
  }
]

COMPANIES TO ANALYZE:
${JSON.stringify(compactLeads, null, 2)}`;
}

export function parseEnrichedJsonArray(rawInput: string): EnrichedPayloadItem[] {
  let cleaned = rawInput.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  const parsed = JSON.parse(cleaned);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Each item in the JSON array must be an object.');
    }
    const obj = item as Record<string, unknown>;
    const domain = String(obj.domain || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    if (!domain) {
      throw new Error('Every enriched record must include a valid "domain" field.');
    }
    const threadStrategy: ThreadStrategy =
      obj.threadStrategy === 'reply_existing' ? 'reply_existing' : 'new_standalone';
    const isTargetFit =
      typeof obj.isTargetFit === 'boolean' ? obj.isTargetFit : true;
    const fitWarning = String(obj.fitWarning || '').trim();
    return {
      domain,
      companyName: String(obj.companyName || domain),
      tradeSpecialty: String(obj.tradeSpecialty || 'Target Organization'),
      primaryContactName: String(obj.primaryContactName || 'Primary Contact'),
      recommendedEmail: String(obj.recommendedEmail || '').trim(),
      detectedWorkflow: String(obj.detectedWorkflow || ''),
      civicTrigger: String(obj.civicTrigger || ''),
      isTargetFit: fitWarning ? false : isTargetFit,
      fitWarning,
      threadStrategy,
      subjectLine: String(obj.subjectLine || ''),
      plainTextBody: String(obj.plainTextBody || ''),
    };
  });
}
