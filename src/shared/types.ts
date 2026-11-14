export type ExtractionMode = 'manual_batch' | 'local_llm' | 'external_api';
export type ProviderPresetId =
  | 'ollama'
  | 'lm_studio'
  | 'gemini_openai'
  | 'openrouter'
  | 'openai'
  | 'groq'
  | 'custom';
export type LeadStatus = 'crawled' | 'pending_review' | 'approved' | 'sent' | 'rejected';
export type ThreadStrategy = 'new_standalone' | 'reply_existing';
export type EmailPriority = 'named' | 'desk' | 'generic';

export interface EmailCandidate {
  email: string;
  priority: EmailPriority;
  source: string;
  syntaxValid: boolean;
  mxValid: boolean;
  mxHost?: string;
  reason: string;
  isRoleFallback?: boolean;
}

export type SearchApiProvider =
  | 'builtin_zero_key'
  | 'serper'
  | 'brave'
  | 'tavily'
  | 'custom';

export interface SearchApiConfig {
  provider: SearchApiProvider;
  apiKey: string;
  customEndpoint: string;
}

export const SEARCH_PROVIDERS: Array<{
  id: SearchApiProvider;
  label: string;
  requiresKey: boolean;
  description: string;
}> = [
  {
    id: 'builtin_zero_key',
    label: 'Zero-Key Built-in Scraper (Default)',
    requiresKey: false,
    description: 'Scrapes public YellowPages & DuckDuckGo HTML listings at $0.00 cost.',
  },
  {
    id: 'serper',
    label: 'Serper.dev (Google Search API)',
    requiresKey: true,
    description: 'Queries google.serper.dev for clean, deep local Google Search results.',
  },
  {
    id: 'brave',
    label: 'Brave Search API',
    requiresKey: true,
    description: 'Queries api.search.brave.com web search index.',
  },
  {
    id: 'tavily',
    label: 'Tavily API',
    requiresKey: true,
    description: 'Queries api.tavily.com search API optimized for company discovery.',
  },
  {
    id: 'custom',
    label: 'Custom Search Endpoint',
    requiresKey: false,
    description: 'Queries any custom JSON search endpoint returning organic URLs.',
  },
];

export interface DiscoveredBusiness {
  id: string;
  companyName: string;
  domain: string;
  websiteUrl: string;
  source: 'YellowPages' | 'DuckDuckGo' | 'Serper' | 'Brave' | 'Tavily' | 'Custom Search';
  locality: string;
  categories: string;
}

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  category: 'local' | 'external' | 'any';
  baseUrl: string;
  requiresApiKey: boolean;
  description: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Local Ollama',
    category: 'local',
    baseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    description: 'Local Ollama server via OpenAI-compatible /v1 endpoint',
  },
  {
    id: 'lm_studio',
    label: 'Local LM Studio',
    category: 'local',
    baseUrl: 'http://localhost:1234/v1',
    requiresApiKey: false,
    description: 'LM Studio local inference server on port 1234',
  },
  {
    id: 'gemini_openai',
    label: 'Google Gemini (OpenAI-Compatible)',
    category: 'external',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresApiKey: true,
    description: 'Gemini REST API using the OpenAI-compatible endpoint',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    category: 'external',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    description: 'Unified gateway for cloud and open-weights models',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'external',
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    description: 'Standard OpenAI REST API endpoint',
  },
  {
    id: 'groq',
    label: 'Groq',
    category: 'external',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    description: 'High-speed Groq Cloud inference endpoint',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-Compatible URL',
    category: 'any',
    baseUrl: '',
    requiresApiKey: false,
    description: 'Any OpenAI-compatible local or remote /chat/completions base URL',
  },
];

export interface OpenAiEngineConfig {
  preset: ProviderPresetId;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  discoveredModels: string[];
}

export interface UserSettings {
  configured: boolean;
  extractionMode: ExtractionMode;
  localConfig: OpenAiEngineConfig;
  externalConfig: OpenAiEngineConfig;
  searchConfig: SearchApiConfig;
  dbPath: string;
}

export interface ProductProfile {
  businessName: string;
  websiteUrl: string;
  senderName: string;
  senderEmail: string;
  senderContext: string;
  valueProp: string;
  targetTrades: string[];
  standardOffer: string;
  promoCode: string;
  promoBenefit: string;
  valueSnippet: string;
  callToAction: string;
  maxLinks: number;
}

export interface LeadRecord {
  id: string;
  domain: string;
  inputUrl: string;
  status: LeadStatus;
  crawlMode: 'live' | 'blocked';
  crawlNote?: string;
  pagesCrawled: string[];
  rawText: string;
  discoveredEmails: EmailCandidate[];
  phones: string[];
  leadershipNames: string[];
  companyName: string;
  tradeSpecialty: string;
  primaryContactName: string;
  recommendedEmail: string;
  detectedWorkflow: string;
  civicTrigger: string;
  isTargetFit?: boolean;
  fitWarning?: string;
  threadStrategy: ThreadStrategy;
  threadId: string;
  threadMessageCount: number;
  inReplyToMessageId: string;
  subjectLine: string;
  plainTextBody: string;
  enrichmentSource?: ExtractionMode | 'gemini';
  gmailDraftId?: string;
  rfc2822Preview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftLogEntry {
  id: string;
  leadId: string;
  email: string;
  threadId: string;
  gmailDraftId: string;
  mode: 'simulated_preview' | 'local_credentials';
  rfc2822Raw: string;
  createdAt: string;
}

export const BLANK_ENGINE_CONFIG: OpenAiEngineConfig = {
  preset: 'custom',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  discoveredModels: [],
};

export const BLANK_SEARCH_CONFIG: SearchApiConfig = {
  provider: 'builtin_zero_key',
  apiKey: '',
  customEndpoint: '',
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  configured: false,
  extractionMode: 'manual_batch',
  localConfig: { ...BLANK_ENGINE_CONFIG },
  externalConfig: { ...BLANK_ENGINE_CONFIG },
  searchConfig: { ...BLANK_SEARCH_CONFIG },
  dbPath: './data/civiclead.db',
};

const VALID_PRESETS = new Set<ProviderPresetId>(PROVIDER_PRESETS.map((p) => p.id));
const VALID_SEARCH_PROVIDERS = new Set<SearchApiProvider>(SEARCH_PROVIDERS.map((p) => p.id));

function normalizeSearchConfig(raw?: Partial<SearchApiConfig> | null): SearchApiConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...BLANK_SEARCH_CONFIG };
  }
  const provider = VALID_SEARCH_PROVIDERS.has(raw.provider as SearchApiProvider)
    ? (raw.provider as SearchApiProvider)
    : 'builtin_zero_key';
  return {
    provider,
    apiKey: String(raw.apiKey ?? '').trim(),
    customEndpoint: String(raw.customEndpoint ?? '').trim(),
  };
}

function normalizeEngineConfig(raw?: Partial<OpenAiEngineConfig> | null): OpenAiEngineConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...BLANK_ENGINE_CONFIG };
  }
  const preset = VALID_PRESETS.has(raw.preset as ProviderPresetId)
    ? (raw.preset as ProviderPresetId)
    : 'custom';
  const discoveredModels = Array.isArray(raw.discoveredModels)
    ? Array.from(new Set(raw.discoveredModels.map((m) => String(m).trim()).filter(Boolean)))
    : [];
  return {
    preset,
    baseUrl: String(raw.baseUrl ?? '').trim(),
    apiKey: String(raw.apiKey ?? '').trim(),
    modelId: String(raw.modelId ?? '').trim(),
    discoveredModels,
  };
}

export function normalizeUserSettings(
  raw?: (Partial<UserSettings> & Record<string, unknown>) | null
): UserSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_USER_SETTINGS,
      localConfig: { ...BLANK_ENGINE_CONFIG },
      externalConfig: { ...BLANK_ENGINE_CONFIG },
      searchConfig: { ...BLANK_SEARCH_CONFIG },
    };
  }
  const rawMode = String(raw.extractionMode || 'manual_batch');
  const extractionMode: ExtractionMode =
    rawMode === 'local_llm'
      ? 'local_llm'
      : rawMode === 'external_api' || rawMode === 'gemini'
        ? 'external_api'
        : 'manual_batch';

  return {
    configured: Boolean(raw.configured),
    extractionMode,
    localConfig: normalizeEngineConfig(raw.localConfig as Partial<OpenAiEngineConfig> | undefined),
    externalConfig: normalizeEngineConfig(
      raw.externalConfig as Partial<OpenAiEngineConfig> | undefined
    ),
    searchConfig: normalizeSearchConfig(raw.searchConfig as Partial<SearchApiConfig> | undefined),
    dbPath: String(raw.dbPath || './data/civiclead.db'),
  };
}

export const BLANK_PRODUCT_PROFILE: ProductProfile = {
  businessName: '',
  websiteUrl: '',
  senderName: '',
  senderEmail: '',
  senderContext: '',
  valueProp: '',
  targetTrades: [],
  standardOffer: '',
  promoCode: '',
  promoBenefit: '',
  valueSnippet: '',
  callToAction: '',
  maxLinks: 1,
};

export const DEFAULT_PRODUCT_PROFILE: ProductProfile = BLANK_PRODUCT_PROFILE;

export function normalizeProductProfile(
  raw?: (Partial<ProductProfile> & Record<string, unknown>) | null
): ProductProfile {
  if (!raw || typeof raw !== 'object') return { ...BLANK_PRODUCT_PROFILE };
  const rawTrades = Array.isArray(raw.targetTrades)
    ? raw.targetTrades.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const rawMaxLinks = Number(raw.maxLinks);

  return {
    businessName: String(raw.businessName ?? raw.companyName ?? '').trimStart(),
    websiteUrl: String(raw.websiteUrl ?? raw.domain ?? '').trim(),
    senderName: String(raw.senderName ?? '').trimStart(),
    senderEmail: String(raw.senderEmail ?? '').trim(),
    senderContext: String(raw.senderContext ?? '').trimStart(),
    valueProp: String(raw.valueProp ?? raw.productSummary ?? '').trimStart(),
    targetTrades: rawTrades,
    standardOffer: String(raw.standardOffer ?? '').trimStart(),
    promoCode: String(raw.promoCode ?? '').trim(),
    promoBenefit: String(raw.promoBenefit ?? raw.promoOffer ?? '').trimStart(),
    valueSnippet: String(raw.valueSnippet ?? '').trimStart(),
    callToAction: String(raw.callToAction ?? '').trimStart(),
    maxLinks: Number.isFinite(rawMaxLinks) && rawMaxLinks >= 0 && rawMaxLinks <= 3 ? rawMaxLinks : 1,
  };
}
