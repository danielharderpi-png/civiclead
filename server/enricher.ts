import {
  buildSystemInstructions,
  type EnrichedPayloadItem,
} from '../src/shared/guardrails.ts';
import type {
  ExtractionMode,
  LeadRecord,
  OpenAiEngineConfig,
  ProductProfile,
  UserSettings,
} from '../src/shared/types.ts';
import { assertSafeAiBaseUrl } from './security.ts';

const NON_TEXT_MODEL_RE =
  /(embedding|embed|whisper|tts|dall-e|moderation|audio|imagen|veo|lyria|rerank)/i;

const ENRICHMENT_JSON_SCHEMA_CONTRACT = `
REQUIRED OUTPUT FORMAT (STRICT JSON OBJECT ONLY):
Return ONLY a single valid JSON object (no markdown fences, no commentary before or after) matching these exact keys and types:
{
  "companyName": "Official Business Name",
  "tradeSpecialty": "Primary industry or customer segment",
  "primaryContactName": "Best individual contact name found on site or 'Primary Contact'",
  "recommendedEmail": "Exact email selected from Discovered Emails, or '' if none found (NEVER invent emails)",
  "detectedWorkflow": "1-2 sentences summarizing exact services/projects on their site (or note if inferred from name/domain)",
  "civicTrigger": "Specific operational timing/workflow connection between their work and the Product Profile",
  "isTargetFit": true,
  "fitWarning": "If isTargetFit is false, brief reason (e.g. 'Youth nonprofit 501(c)(3), not a contractor'); otherwise ''",
  "threadStrategy": "new_standalone or reply_existing",
  "subjectLine": "Short, natural peer-to-peer subject line (3-7 words, no hype)",
  "plainTextBody": "80-150 word natural 100% plain-text email with greeting, 2-3 cohesive short paragraphs, and clean multi-line sign-off"
}`.trim();

function sanitizePlainText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export function normalizeOpenAiBaseUrl(rawUrl: string): string {
  let cleaned = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!cleaned) {
    throw new Error('Base URL is required. Open "Configure AI Engine" to set a provider Base URL.');
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `http://${cleaned}`;
  }
  cleaned = cleaned
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '')
    .replace(/\/api\/(?:chat|generate)$/i, '/v1')
    .replace(/\/+$/, '');

  // Validate URL syntax and block unsafe metadata/credentialed URLs
  assertSafeAiBaseUrl(cleaned, true);
  return cleaned;
}

export function filterTextModels(modelIds: string[]): string[] {
  const unique = Array.from(
    new Set(modelIds.map((m) => m.trim()).filter((m) => m.length > 0 && !NON_TEXT_MODEL_RE.test(m)))
  );
  return unique.sort((a, b) => a.localeCompare(b));
}

export function extractJsonObjectFromModelOutput(rawText: string): Record<string, unknown> {
  // 1. Strip <think>...</think> and <reasoning>...</reasoning> blocks emitted by reasoning models
  let cleaned = (rawText || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  }

  const unwrap = (val: unknown): Record<string, unknown> => {
    const target = Array.isArray(val) ? val[0] : val;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error('Model response did not contain a valid JSON object.');
    }
    return target as Record<string, unknown>;
  };

  // 3. Direct JSON.parse attempt
  try {
    return unwrap(JSON.parse(cleaned));
  } catch {
    // Fall through to balanced-brace scanner
  }

  // 4. Extract first balanced {...} JSON object from surrounding prose
  let startIdx = cleaned.indexOf('{');
  while (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(startIdx, i + 1);
          try {
            return unwrap(JSON.parse(candidate));
          } catch {
            break;
          }
        }
      }
    }

    startIdx = cleaned.indexOf('{', startIdx + 1);
  }

  throw new Error('Could not extract a valid JSON object from model output.');
}

function extractChatContent(payload: unknown): string {
  const data = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
      text?: string;
    }>;
  };
  const firstChoice = data?.choices?.[0];
  const content = firstChoice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || '').join('');
  }
  return firstChoice?.text || '';
}

function buildAuthHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const cleanKey = (apiKey || '').trim();
  if (cleanKey) {
    headers.Authorization = `Bearer ${cleanKey}`;
  }
  return headers;
}

function buildLeadUserPrompt(lead: LeadRecord, profile: ProductProfile, angleHint?: string): string {
  const targetIndustries = profile.targetTrades.map((t) => t.trim()).filter(Boolean);
  const cleanText = (lead.rawText || '').trim();
  const crawlStatus =
    lead.crawlMode === 'blocked'
      ? 'website_unreachable_infer_from_company_and_domain'
      : cleanText.length < 100
        ? 'minimal_site_text_infer_from_company_and_domain'
        : 'live_site_text_available';
  return [
    'Write a genuinely natural, thoughtful peer-to-peer outreach email for this company using the system rules and the data below, then return the JSON object.',
    `Target Company Name: ${lead.companyName || lead.domain}`,
    `Target Domain: ${lead.domain}`,
    `Crawl Status: ${crawlStatus}`,
    lead.tradeSpecialty ? `Known Industry / Specialty: ${lead.tradeSpecialty}` : '',
    `Discovered Emails (ranked): ${lead.discoveredEmails.map((e) => `${e.email} [${e.priority}]`).join(', ') || 'None found'}`,
    `Leadership Names Found: ${lead.leadershipNames.join(', ') || 'None found'}`,
    `Existing Thread Context: ${lead.threadMessageCount > 0 ? `YES (threadId=${lead.threadId}, messages=${lead.threadMessageCount})` : 'NO prior thread'}`,
    angleHint ? `Operator Angle Preference: ${angleHint}` : '',
    targetIndustries.length > 0 ? `Target Industries: ${targetIndustries.join(', ')}` : '',
    '',
    'CRAWLED WEBSITE TEXT:',
    cleanText.slice(0, 6500),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function fetchAvailableModels(
  rawBaseUrl: string,
  apiKey?: string
): Promise<{ ok: true; endpointUsed: string; models: string[] }> {
  const baseUrl = normalizeOpenAiBaseUrl(rawBaseUrl);
  const parsed = new URL(baseUrl);
  const candidateEndpoints = Array.from(
    new Set([
      `${baseUrl}/models`,
      ...(parsed.pathname === '' || parsed.pathname === '/'
        ? [`${parsed.origin}/v1/models`, `${parsed.origin}/api/tags`]
        : [`${parsed.origin}/api/tags`]),
    ])
  );

  const headers = buildAuthHeaders(apiKey);
  let lastStatus = 0;
  let lastErrorText = '';

  for (const endpoint of candidateEndpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;

      if (!res.ok) {
        lastErrorText = (await res.text()).slice(0, 220);
        continue;
      }

      const data = (await res.json()) as {
        data?: Array<{ id?: string; name?: string }>;
        models?: Array<{ id?: string; name?: string; model?: string }>;
      };

      const rawIds: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const entry of data.data) {
          const id = entry?.id || entry?.name || '';
          if (id) rawIds.push(id);
        }
      }
      if (Array.isArray(data?.models)) {
        for (const entry of data.models) {
          const id = entry?.id || entry?.name || entry?.model || '';
          if (id) rawIds.push(id);
        }
      }
      if (Array.isArray(data)) {
        for (const entry of data as Array<{ id?: string; name?: string }>) {
          const id = typeof entry === 'string' ? entry : entry?.id || entry?.name || '';
          if (id) rawIds.push(id);
        }
      }

      return {
        ok: true,
        endpointUsed: endpoint,
        models: filterTextModels(rawIds),
      };
    } catch (err) {
      clearTimeout(timer);
      lastErrorText = err instanceof Error ? err.message : String(err);
    }
  }

  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error(`Authentication rejected (HTTP ${lastStatus}). Check your API Key.`);
  }
  throw new Error(
    lastStatus
      ? `Provider /models returned HTTP ${lastStatus}${lastErrorText ? `: ${lastErrorText}` : ''}`
      : `Could not reach ${baseUrl}. Verify the server is running and the Base URL is valid.`
  );
}

export async function testAiConnection(
  rawBaseUrl: string,
  apiKey: string | undefined,
  rawModelId: string
): Promise<{ ok: true; endpointUsed: string; latencyMs: number; reply: string }> {
  const baseUrl = normalizeOpenAiBaseUrl(rawBaseUrl);
  const modelId = (rawModelId || '').trim();
  if (!modelId) {
    throw new Error('Model ID is required before testing the connection.');
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const headers = buildAuthHeaders(apiKey);
  const startedAt = Date.now();

  const runPing = async (useCompletionTokens: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const bodyPayload: Record<string, unknown> = {
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with OK' }],
        temperature: 0,
      };
      if (useCompletionTokens) {
        bodyPayload.max_completion_tokens = 16;
      } else {
        bodyPayload.max_tokens = 5;
      }

      return await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(bodyPayload),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await runPing(false);
  if (res.status === 400) {
    const text = await res.text();
    if (text.includes('max_completion_tokens')) {
      res = await runPing(true);
    } else {
      throw new Error(`HTTP 400 from ${endpoint}: ${text.slice(0, 220)}`);
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status} from ${endpoint}: ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const reply = extractChatContent(data).trim() || 'OK';

  return {
    ok: true,
    endpointUsed: endpoint,
    latencyMs: Date.now() - startedAt,
    reply: reply.slice(0, 80),
  };
}

async function enrichViaOpenAiCompatible(
  lead: LeadRecord,
  profile: ProductProfile,
  config: OpenAiEngineConfig,
  angleHint?: string
): Promise<EnrichedPayloadItem> {
  const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl);
  const modelId = (config.modelId || '').trim();
  if (!modelId) {
    throw new Error(
      'No Model ID is configured. Open "Configure AI Engine" to select or enter a Model ID.'
    );
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const systemPrompt = `${buildSystemInstructions(profile)}\n\n${ENRICHMENT_JSON_SCHEMA_CONTRACT}`;
  const userPrompt = buildLeadUserPrompt(lead, profile, angleHint);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: buildAuthHeaders(config.apiKey),
      body: JSON.stringify({
        model: modelId,
        temperature: 0.55,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Provider returned HTTP ${res.status}: ${errText.slice(0, 260)}`);
    }

    const payload = await res.json();
    const rawContent = extractChatContent(payload);
    if (!rawContent.trim()) {
      throw new Error('Provider returned an empty message content.');
    }

    const parsed = extractJsonObjectFromModelOutput(rawContent);

    const fitWarning = String(parsed.fitWarning || '').trim();
    const isTargetFit =
      fitWarning ? false : typeof parsed.isTargetFit === 'boolean' ? parsed.isTargetFit : true;
    const validRealEmails = lead.discoveredEmails.filter(
      (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback'
    );
    const rawRecommended = String(parsed.recommendedEmail || '').trim().toLowerCase();
    const verifiedRecommended = validRealEmails.some(
      (e) => e.email.toLowerCase() === rawRecommended
    )
      ? rawRecommended
      : lead.recommendedEmail &&
          validRealEmails.some((e) => e.email.toLowerCase() === lead.recommendedEmail.toLowerCase())
        ? lead.recommendedEmail
        : validRealEmails[0]?.email || '';

    return {
      domain: lead.domain,
      companyName: String(parsed.companyName || lead.companyName || lead.domain),
      tradeSpecialty: String(parsed.tradeSpecialty || lead.tradeSpecialty || 'Target Organization'),
      primaryContactName: String(
        parsed.primaryContactName || lead.primaryContactName || 'Primary Contact'
      ),
      recommendedEmail: verifiedRecommended,
      detectedWorkflow: String(parsed.detectedWorkflow || ''),
      civicTrigger: String(parsed.civicTrigger || ''),
      isTargetFit,
      fitWarning,
      threadStrategy:
        lead.threadMessageCount > 0 || parsed.threadStrategy === 'reply_existing'
          ? 'reply_existing'
          : 'new_standalone',
      subjectLine: sanitizePlainText(String(parsed.subjectLine || '')),
      plainTextBody: sanitizePlainText(String(parsed.plainTextBody || '')),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      throw new Error(
        `Could not connect to ${endpoint}. Open "Configure AI Engine" to test your Base URL & Model ID, or switch to Manual Batch ($0.00).`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichLead(
  lead: LeadRecord,
  profile: ProductProfile,
  settings: UserSettings,
  options: { overrideMode?: ExtractionMode; angleHint?: string } = {}
): Promise<{ item: EnrichedPayloadItem; source: ExtractionMode }> {
  const mode = options.overrideMode || settings.extractionMode;

  if (mode === 'manual_batch') {
    throw new Error(
      'Extraction Mode is set to Manual Batch ($0.00). Use "Export Raw Crawl Prompt" and "Import Enriched JSON", or switch engines in "Configure AI Engine".'
    );
  }

  const activeConfig = mode === 'local_llm' ? settings.localConfig : settings.externalConfig;
  const item = await enrichViaOpenAiCompatible(lead, profile, activeConfig, options.angleHint);
  return { item, source: mode };
}
