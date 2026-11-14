import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import {
  DEFAULT_PRODUCT_PROFILE,
  DEFAULT_USER_SETTINGS,
  normalizeProductProfile,
  normalizeUserSettings,
  type DraftLogEntry,
  type LeadRecord,
  type ProductProfile,
  type UserSettings,
} from '../src/shared/types.ts';
import { getAppBaseDir } from './runtime.ts';

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message || '';
  if (msg.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const dbPath = path.resolve(getAppBaseDir(), './data/civiclead.db');

let db: DatabaseSyncType;
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  db = new DatabaseSync(dbPath);
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    // Best-effort permission hardening across filesystems
  }
} catch {
  db = new DatabaseSync(':memory:');
}

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS product_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS draft_log (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    email TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    gmail_draft_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    rfc2822_raw TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS engine_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export function getStoredUserSettings(): UserSettings | null {
  const row = db.prepare('SELECT json FROM engine_settings WHERE id = 1').get() as
    | { json: string }
    | undefined;
  if (!row) return null;
  try {
    return normalizeUserSettings(JSON.parse(row.json) as Record<string, unknown>);
  } catch {
    return {
      ...DEFAULT_USER_SETTINGS,
      localConfig: { ...DEFAULT_USER_SETTINGS.localConfig },
      externalConfig: { ...DEFAULT_USER_SETTINGS.externalConfig },
    };
  }
}

export function saveStoredUserSettings(settings: UserSettings): UserSettings {
  const normalized = normalizeUserSettings(settings as unknown as Record<string, unknown>);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO engine_settings (id, json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(normalized), now);
  return normalized;
}

export function getProfile(): ProductProfile {
  const row = db.prepare('SELECT json FROM product_profile WHERE id = 1').get() as
    | { json: string }
    | undefined;
  if (!row) {
    saveProfile(DEFAULT_PRODUCT_PROFILE);
    return DEFAULT_PRODUCT_PROFILE;
  }
  try {
    return normalizeProductProfile(JSON.parse(row.json) as Record<string, unknown>);
  } catch {
    return DEFAULT_PRODUCT_PROFILE;
  }
}

export function saveProfile(profile: ProductProfile): ProductProfile {
  const merged = normalizeProductProfile(profile as unknown as Record<string, unknown>);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO product_profile (id, json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(merged), now);
  return merged;
}

function stripFabricatedFallbacks(lead: LeadRecord): LeadRecord {
  const realEmails = (lead.discoveredEmails || []).filter(
    (e) => !e.isRoleFallback && e.source !== 'mx_role_fallback'
  );
  const hadFallbacks = realEmails.length !== (lead.discoveredEmails || []).length;
  const rec = (lead.recommendedEmail || '').trim();
  const recWasFallback =
    rec !== '' &&
    (lead.discoveredEmails || []).some(
      (e) =>
        e.email.toLowerCase() === rec.toLowerCase() &&
        (e.isRoleFallback || e.source === 'mx_role_fallback')
    );

  const uniquePages = Array.from(new Set(lead.pagesCrawled || []));
  const hadDuplicatePages = uniquePages.length !== (lead.pagesCrawled || []).length;

  if (!hadFallbacks && !recWasFallback && !hadDuplicatePages) return lead;

  return {
    ...lead,
    pagesCrawled: uniquePages,
    discoveredEmails: realEmails,
    recommendedEmail: recWasFallback ? realEmails[0]?.email || '' : rec,
  };
}

export function listLeads(): LeadRecord[] {
  const rows = db
    .prepare('SELECT json FROM leads ORDER BY updated_at DESC')
    .all() as { json: string }[];
  return rows
    .map((r) => {
      try {
        return stripFabricatedFallbacks(JSON.parse(r.json) as LeadRecord);
      } catch {
        return null;
      }
    })
    .filter((item): item is LeadRecord => item !== null);
}

export function getLeadById(id: string): LeadRecord | null {
  const row = db.prepare('SELECT json FROM leads WHERE id = ?').get(id) as
    | { json: string }
    | undefined;
  if (!row) return null;
  try {
    return stripFabricatedFallbacks(JSON.parse(row.json) as LeadRecord);
  } catch {
    return null;
  }
}

export function getLeadByDomain(domain: string): LeadRecord | null {
  const row = db.prepare('SELECT json FROM leads WHERE domain = ?').get(domain.toLowerCase()) as
    | { json: string }
    | undefined;
  if (!row) return null;
  try {
    return stripFabricatedFallbacks(JSON.parse(row.json) as LeadRecord);
  } catch {
    return null;
  }
}

export function upsertLead(lead: LeadRecord): LeadRecord {
  const now = new Date().toISOString();
  const sanitized = stripFabricatedFallbacks(lead);
  const normalized: LeadRecord = {
    ...sanitized,
    domain: sanitized.domain.toLowerCase(),
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO leads (id, domain, status, json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       status = excluded.status,
       json = excluded.json,
       updated_at = excluded.updated_at`
  ).run(normalized.id, normalized.domain, normalized.status, JSON.stringify(normalized), now);
  return normalized;
}

export function upsertLeads(leads: LeadRecord[]): LeadRecord[] {
  return leads.map((lead) => upsertLead(lead));
}

export function deleteLead(id: string): void {
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
}

export function deleteLeadsBatch(ids: string[]): number {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return 0;
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const result = db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...uniqueIds);
  return Number(result.changes || 0);
}

export function clearAllLeads(): number {
  const result = db.prepare('DELETE FROM leads').run();
  return Number(result.changes || 0);
}

export function recordDraft(entry: DraftLogEntry): DraftLogEntry {
  db.prepare(
    `INSERT INTO draft_log (id, lead_id, email, thread_id, gmail_draft_id, mode, rfc2822_raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    entry.leadId,
    entry.email,
    entry.threadId,
    entry.gmailDraftId,
    entry.mode,
    entry.rfc2822Raw,
    entry.createdAt
  );
  return entry;
}

export function listDraftLogs(): DraftLogEntry[] {
  const rows = db
    .prepare('SELECT * FROM draft_log ORDER BY created_at DESC LIMIT 100')
    .all() as Array<{
    id: string;
    lead_id: string;
    email: string;
    thread_id: string;
    gmail_draft_id: string;
    mode: 'simulated_preview' | 'local_credentials';
    rfc2822_raw: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    email: r.email,
    threadId: r.thread_id,
    gmailDraftId: r.gmail_draft_id,
    mode: r.mode,
    rfc2822Raw: r.rfc2822_raw,
    createdAt: r.created_at,
  }));
}

export function getDbPath(): string {
  return dbPath;
}
