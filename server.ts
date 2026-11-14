import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  checkMxRecord,
  classifyEmailPriority,
  collapseDoubledCompanyName,
  crawlTargetDomain,
  isValidEmailSyntax,
  normalizeDomain,
  sortEmailCandidates,
} from './server/crawler.ts';
import {
  clearAllLeads,
  deleteLead,
  deleteLeadsBatch,
  getDbPath,
  getLeadByDomain,
  getLeadById,
  getProfile,
  listDraftLogs,
  listLeads,
  recordDraft,
  saveProfile,
  upsertLead,
} from './server/db.ts';
import { discoverLocalBusinesses } from './server/discoverer.ts';
import { enrichLead, fetchAvailableModels, testAiConnection } from './server/enricher.ts';
import { buildBatchCsv, buildBatchPlainText } from './server/exporter.ts';
import { buildRfc2822PlainTextDraft } from './server/gmailDraft.ts';
import { getUserSettings, saveUserSettings } from './server/settings.ts';
import { evaluateDeliverability, parseEnrichedJsonArray } from './src/shared/guardrails.ts';
import {
  BLANK_PRODUCT_PROFILE,
  normalizeProductProfile,
  type ExtractionMode,
  type LeadRecord,
  type UserSettings,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      dbPath: getDbPath(),
    });
  });

  app.get('/api/settings', (_req, res) => {
    res.json({ settings: getUserSettings() });
  });

  app.put('/api/settings', (req, res) => {
    try {
      const patch = req.body as Partial<UserSettings>;
      const updated = saveUserSettings(patch);
      res.json({ settings: updated });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to save user settings',
      });
    }
  });

  app.get('/api/profile', (_req, res) => {
    res.json({ profile: getProfile() });
  });

  app.put('/api/profile', (req, res) => {
    try {
      const incoming = req.body as Record<string, unknown>;
      const current = getProfile();
      const updated = saveProfile(normalizeProductProfile({ ...current, ...incoming }));
      res.json({ profile: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save profile' });
    }
  });

  app.post('/api/profile/reset-blank', (_req, res) => {
    const updated = saveProfile(BLANK_PRODUCT_PROFILE);
    res.json({ profile: updated });
  });

  app.get('/api/leads', (_req, res) => {
    res.json({ leads: listLeads(), draftLogs: listDraftLogs() });
  });

  app.post('/api/discover', async (req, res) => {
    try {
      const { trade, location, searchConfig } = req.body as {
        trade?: string;
        location?: string;
        searchConfig?: UserSettings['searchConfig'];
      };
      const cleanTrade = (trade || '').trim();
      const cleanLocation = (location || '').trim();
      if (!cleanTrade || !cleanLocation) {
        res.status(400).json({ error: 'Both Target Trade/Keyword and Target Location are required.' });
        return;
      }
      const activeSearchConfig = searchConfig || getUserSettings().searchConfig;
      const data = await discoverLocalBusinesses(cleanTrade, cleanLocation, activeSearchConfig);
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Discovery search failed',
      });
    }
  });

  app.post('/api/crawl', async (req, res) => {
    const body = req.body as {
      urls?: string[];
      targets?: Array<{ url: string; companyName?: string }>;
    };
    const normalizedTargets: Array<{ url: string; companyName?: string }> = [];
    const seenTargetKeys = new Set<string>();

    if (Array.isArray(body.targets)) {
      for (const item of body.targets) {
        const cleanUrl = (item?.url || '').trim();
        if (!cleanUrl || seenTargetKeys.has(cleanUrl.toLowerCase())) continue;
        seenTargetKeys.add(cleanUrl.toLowerCase());
        normalizedTargets.push({
          url: cleanUrl,
          companyName: item?.companyName?.trim() || undefined,
        });
      }
    }

    if (Array.isArray(body.urls)) {
      for (const raw of body.urls) {
        const cleanUrl = String(raw || '').trim();
        if (!cleanUrl || seenTargetKeys.has(cleanUrl.toLowerCase())) continue;
        seenTargetKeys.add(cleanUrl.toLowerCase());
        normalizedTargets.push({ url: cleanUrl });
      }
    }

    const targetsToCrawl = normalizedTargets.slice(0, 25);

    if (targetsToCrawl.length === 0) {
      res.status(400).json({ error: 'Provide at least one domain or URL to crawl.' });
      return;
    }

    const crawledLeads: LeadRecord[] = [];
    const errors: Array<{ url: string; error: string }> = [];

    for (const target of targetsToCrawl) {
      try {
        const lead = await crawlTargetDomain(target.url, {
          preferredCompanyName: target.companyName,
        });
        const existing = getLeadByDomain(lead.domain);

        if (!existing) {
          crawledLeads.push(upsertLead(lead));
          continue;
        }

        const existingRealEmails = existing.discoveredEmails.filter(
          (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback' && e.source !== 'manual_custom'
        );
        const newHasRealEmails = lead.discoveredEmails.length > 0;
        const preserveExistingOnWafBlock =
          existingRealEmails.length > 0 && (lead.crawlMode === 'blocked' || !newHasRealEmails);

        const customEmails = existing.discoveredEmails.filter((e) => e.source === 'manual_custom');
        const baseEmails = preserveExistingOnWafBlock
          ? existingRealEmails
          : lead.discoveredEmails;

        const mergedEmails = sortEmailCandidates([
          ...customEmails,
          ...baseEmails.filter(
            (e) => !customEmails.some((c) => c.email.toLowerCase() === e.email.toLowerCase())
          ),
        ]);

        const hasCustomRecommended = customEmails.some(
          (c) => c.email.toLowerCase() === existing.recommendedEmail.toLowerCase()
        );

        const preferredCleanName = target.companyName
          ? collapseDoubledCompanyName(target.companyName)
          : '';

        const merged: LeadRecord = {
          ...existing,
          companyName:
            preferredCleanName ||
            (lead.crawlMode === 'live' && lead.companyName
              ? collapseDoubledCompanyName(lead.companyName)
              : existing.companyName || lead.companyName),
          primaryContactName:
            existing.primaryContactName &&
            existing.primaryContactName !== 'Primary Contact'
              ? existing.primaryContactName
              : lead.primaryContactName,
          crawlMode: lead.crawlMode,
          crawlNote: preserveExistingOnWafBlock
            ? 'HTTP Blocked (MX Checked) on re-crawl — preserved previously scraped emails & contact data'
            : lead.crawlNote,
          pagesCrawled: preserveExistingOnWafBlock ? existing.pagesCrawled : lead.pagesCrawled,
          rawText: preserveExistingOnWafBlock ? existing.rawText : lead.rawText,
          discoveredEmails: mergedEmails,
          phones: preserveExistingOnWafBlock ? existing.phones : lead.phones,
          leadershipNames: preserveExistingOnWafBlock
            ? existing.leadershipNames
            : lead.leadershipNames,
          recommendedEmail: hasCustomRecommended
            ? existing.recommendedEmail
            : preserveExistingOnWafBlock
              ? existing.recommendedEmail || mergedEmails[0]?.email || ''
              : lead.recommendedEmail || mergedEmails[0]?.email || existing.recommendedEmail,
        };
        crawledLeads.push(upsertLead(merged));
      } catch (err) {
        errors.push({
          url: target.url,
          error: err instanceof Error ? err.message : 'Crawl failed',
        });
      }
    }

    res.json({
      crawled: crawledLeads,
      leads: listLeads(),
      errors,
    });
  });

  app.post('/api/ai/models', async (req, res) => {
    const { baseUrl, apiKey } = (req.body || {}) as { baseUrl?: string; apiKey?: string };
    try {
      const result = await fetchAvailableModels(baseUrl || '', apiKey);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch models',
      });
    }
  });

  app.post('/api/ai/test', async (req, res) => {
    const { baseUrl, apiKey, modelId } = (req.body || {}) as {
      baseUrl?: string;
      apiKey?: string;
      modelId?: string;
    };
    try {
      const result = await testAiConnection(baseUrl || '', apiKey, modelId || '');
      res.json(result);
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    }
  });

  app.post('/api/enrich', async (req, res) => {
    const body = req.body as {
      leadIds?: string[];
      overrideMode?: ExtractionMode;
      angleHint?: string;
    };
    const profile = getProfile();
    if (!profile.businessName.trim() || !profile.senderName.trim()) {
      res.status(400).json({ error: 'Please enter your Business Name and Sender Name first.' });
      return;
    }
    if (profile.promoCode.trim() && !profile.promoBenefit.trim()) {
      res.status(400).json({
        error: 'Please enter the Exact Meaning of your Promo Code (Promo Benefit) before generating drafts.',
      });
      return;
    }
    const settings = getUserSettings();
    const leadIds = Array.isArray(body.leadIds) ? body.leadIds : [];
    if (leadIds.length === 0) {
      res.status(400).json({ error: 'Select at least one crawled lead to enrich.' });
      return;
    }

    const updatedLeads: LeadRecord[] = [];
    const errors: Array<{ id: string; domain: string; error: string }> = [];

    for (const id of leadIds) {
      const lead = getLeadById(id);
      if (!lead) continue;

      try {
        const { item, source } = await enrichLead(lead, profile, settings, {
          overrideMode: body.overrideMode,
          angleHint: body.angleHint,
        });

        const realEmails = lead.discoveredEmails.filter(
          (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback'
        );
        const candidateMatch = realEmails.find(
          (e) => e.email.toLowerCase() === (item.recommendedEmail || '').trim().toLowerCase()
        );
        const verifiedEmail =
          candidateMatch?.email ||
          (lead.recommendedEmail &&
          realEmails.some((e) => e.email.toLowerCase() === lead.recommendedEmail.toLowerCase())
            ? lead.recommendedEmail
            : realEmails[0]?.email || '');

        const nextLead = upsertLead({
          ...lead,
          companyName: item.companyName || lead.companyName,
          tradeSpecialty: item.tradeSpecialty || lead.tradeSpecialty,
          primaryContactName: item.primaryContactName || lead.primaryContactName,
          recommendedEmail: verifiedEmail,
          detectedWorkflow: item.detectedWorkflow,
          civicTrigger: item.civicTrigger,
          isTargetFit: item.isTargetFit,
          fitWarning: item.fitWarning,
          threadStrategy: item.threadStrategy,
          subjectLine: item.subjectLine,
          plainTextBody: item.plainTextBody,
          enrichmentSource: source,
          status: 'pending_review',
        });
        updatedLeads.push(nextLead);
      } catch (err) {
        errors.push({
          id: lead.id,
          domain: lead.domain,
          error: err instanceof Error ? err.message : 'Enrichment failed',
        });
      }
    }

    if (updatedLeads.length === 0 && errors.length > 0) {
      res.status(422).json({
        error: errors[0].error,
        errors,
        leads: listLeads(),
      });
      return;
    }

    res.json({
      enriched: updatedLeads,
      leads: listLeads(),
      errors,
    });
  });

  app.post('/api/enrich/import', (req, res) => {
    try {
      const { rawJson } = req.body as { rawJson?: string };
      if (!rawJson || !rawJson.trim()) {
        res.status(400).json({ error: 'Paste a valid JSON array from your AI chat session.' });
        return;
      }

      const items = parseEnrichedJsonArray(rawJson);
      const imported: LeadRecord[] = [];
      const now = new Date().toISOString();

      for (const item of items) {
        const { domain } = normalizeDomain(item.domain);
        const existing = getLeadByDomain(domain);

        if (existing) {
          const emailList = existing.discoveredEmails.filter(
            (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback'
          );
          const aiChosenEmail = (item.recommendedEmail || '').trim().toLowerCase();
          const matchedExisting = emailList.find((e) => e.email.toLowerCase() === aiChosenEmail);
          const verifiedExistingEmail =
            matchedExisting?.email ||
            (existing.recommendedEmail &&
            emailList.some((e) => e.email.toLowerCase() === existing.recommendedEmail.toLowerCase())
              ? existing.recommendedEmail
              : emailList[0]?.email || '');
          imported.push(
            upsertLead({
              ...existing,
              companyName: item.companyName || existing.companyName,
              tradeSpecialty: item.tradeSpecialty || existing.tradeSpecialty,
              primaryContactName: item.primaryContactName || existing.primaryContactName,
              recommendedEmail: verifiedExistingEmail,
              discoveredEmails: sortEmailCandidates(emailList),
              detectedWorkflow: item.detectedWorkflow,
              civicTrigger: item.civicTrigger,
              isTargetFit: item.isTargetFit,
              fitWarning: item.fitWarning,
              threadStrategy:
                existing.threadMessageCount > 0 ? item.threadStrategy : 'new_standalone',
              subjectLine: item.subjectLine,
              plainTextBody: item.plainTextBody,
              enrichmentSource: 'manual_batch',
              status: 'pending_review',
            })
          );
        } else {
          const importedEmail = (item.recommendedEmail || '').trim().toLowerCase();
          const importedList =
            importedEmail && isValidEmailSyntax(importedEmail)
              ? [
                  {
                    email: importedEmail,
                    ...classifyEmailPriority(importedEmail),
                    source: 'manual_import',
                    syntaxValid: true,
                    mxValid: false,
                  },
                ]
              : [];
          imported.push(
            upsertLead({
              id: crypto.randomUUID(),
              domain,
              inputUrl: `https://${domain}`,
              status: 'pending_review',
              crawlMode: 'live',
              crawlNote: 'Imported via Manual Batch JSON',
              pagesCrawled: [`https://${domain}/`],
              rawText: item.detectedWorkflow,
              discoveredEmails: importedList,
              phones: [],
              leadershipNames: item.primaryContactName ? [item.primaryContactName] : [],
              companyName: item.companyName || domain,
              tradeSpecialty: item.tradeSpecialty || 'Target Organization',
              primaryContactName: item.primaryContactName || 'Primary Contact',
              recommendedEmail: importedList[0]?.email || '',
              detectedWorkflow: item.detectedWorkflow,
              civicTrigger: item.civicTrigger,
              isTargetFit: item.isTargetFit,
              fitWarning: item.fitWarning,
              threadStrategy: item.threadStrategy,
              threadId: '',
              threadMessageCount: 0,
              inReplyToMessageId: '',
              subjectLine: item.subjectLine,
              plainTextBody: item.plainTextBody,
              enrichmentSource: 'manual_batch',
              createdAt: now,
              updatedAt: now,
            })
          );
        }
      }

      res.json({
        importedCount: imported.length,
        imported,
        leads: listLeads(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid JSON array format.',
      });
    }
  });

  app.patch('/api/leads/:id', async (req, res) => {
    const existing = getLeadById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    const patch = req.body as Partial<LeadRecord>;
    let nextEmails = patch.discoveredEmails ?? existing.discoveredEmails;

    if (typeof patch.recommendedEmail === 'string') {
      const cleanedEmail = patch.recommendedEmail.trim().toLowerCase();
      if (cleanedEmail) {
        const alreadyExists = nextEmails.some(
          (e) => e.email.toLowerCase() === cleanedEmail
        );
        if (!alreadyExists) {
          const emailDomain = cleanedEmail.split('@')[1] || existing.domain;
          const mxInfo = await checkMxRecord(emailDomain);
          const { priority, reason } = classifyEmailPriority(cleanedEmail);
          nextEmails = sortEmailCandidates([
            {
              email: cleanedEmail,
              priority,
              source: 'manual_custom',
              syntaxValid: isValidEmailSyntax(cleanedEmail),
              mxValid: mxInfo.mxValid,
              mxHost: mxInfo.mxHost,
              reason: `${reason} (Manual entry)`,
              isRoleFallback: false,
            },
            ...nextEmails,
          ]);
        }
        patch.recommendedEmail = cleanedEmail;
      }
    }

    const updated = upsertLead({
      ...existing,
      ...patch,
      discoveredEmails: nextEmails,
      id: existing.id,
      domain: existing.domain,
    });
    res.json({ lead: updated, leads: listLeads() });
  });

  app.delete('/api/leads/batch', (req, res) => {
    const body = (req.body || {}) as { ids?: string[]; all?: boolean };
    if (body.all === true) {
      const deletedCount = clearAllLeads();
      res.json({ ok: true, cleared: true, deletedCount, leads: listLeads() });
      return;
    }
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Provide at least one lead id or { all: true }.' });
      return;
    }
    const deletedCount = deleteLeadsBatch(ids);
    res.json({ ok: true, cleared: false, deletedCount, leads: listLeads() });
  });

  app.delete('/api/leads/:id', (req, res) => {
    deleteLead(req.params.id);
    res.json({ ok: true, leads: listLeads() });
  });

  app.post('/api/gmail/draft', (req, res) => {
    try {
      const { leadId, force } = req.body as { leadId?: string; force?: boolean };
      if (!leadId) {
        res.status(400).json({ error: 'leadId is required' });
        return;
      }
      const lead = getLeadById(leadId);
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      const profile = getProfile();
      const report = evaluateDeliverability(lead.subjectLine, lead.plainTextBody, profile.maxLinks);
      if (!report.passed && !force) {
        res.status(422).json({
          error: 'Deliverability guardrails failed. Fix flagged items before staging draft.',
          report,
        });
        return;
      }

      const built = buildRfc2822PlainTextDraft(lead, profile);
      recordDraft(built.logEntry);

      const updated = upsertLead({
        ...lead,
        status: 'approved',
        gmailDraftId: built.logEntry.gmailDraftId,
        rfc2822Preview: built.rfc2822Raw,
      });

      res.json({
        lead: updated,
        leads: listLeads(),
        draftLogs: listDraftLogs(),
        draft: built.logEntry,
        gmailPayload: built.gmailPayload,
        rfc2822Raw: built.rfc2822Raw,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to stage RFC 2822 draft',
      });
    }
  });

  app.get('/api/export/batch', (req, res) => {
    const statusFilter = String(req.query.status || 'enriched');
    const allLeads = listLeads();
    const filtered =
      statusFilter === 'all'
        ? allLeads
        : statusFilter === 'approved'
          ? allLeads.filter((l) => l.status === 'approved' || l.status === 'sent')
          : allLeads.filter(
              (l) =>
                l.status === 'pending_review' ||
                l.status === 'approved' ||
                l.status === 'sent' ||
                Boolean(l.plainTextBody?.trim())
            );

    res.json({
      count: filtered.length,
      json: JSON.stringify(filtered, null, 2),
      csv: buildBatchCsv(filtered),
      plainText: buildBatchPlainText(filtered),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = 'true';
    process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CivicLead Engine server listening on http://localhost:${PORT}`);
  });
}

startServer();
