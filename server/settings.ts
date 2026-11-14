import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_USER_SETTINGS,
  normalizeUserSettings,
  type UserSettings,
} from '../src/shared/types.ts';
import { getStoredUserSettings, saveStoredUserSettings } from './db.ts';
import { isMaskedApiKey } from './security.ts';

const SETTINGS_FILE = path.resolve(process.cwd(), 'user-settings.json');

let memorySettings: UserSettings | null = null;

function preserveMaskedKey(incomingKey: string | undefined, currentKey: string): string {
  if (incomingKey === undefined || isMaskedApiKey(incomingKey)) {
    return currentKey;
  }
  return incomingKey;
}

export function getUserSettings(): UserSettings {
  const fromDb = getStoredUserSettings();
  if (fromDb) {
    memorySettings = fromDb;
    return fromDb;
  }

  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = normalizeUserSettings(JSON.parse(raw) as Record<string, unknown>);
      memorySettings = saveStoredUserSettings(parsed);
      return memorySettings;
    } catch {
      // Fall through to memory/defaults
    }
  }

  return (
    memorySettings ||
    normalizeUserSettings(DEFAULT_USER_SETTINGS as unknown as Record<string, unknown>)
  );
}

export function saveUserSettings(patch: Partial<UserSettings>): UserSettings {
  const current = getUserSettings();
  const next = normalizeUserSettings({
    ...current,
    ...patch,
    dbPath: current.dbPath || './data/civiclead.db',
    localConfig: patch.localConfig
      ? {
          ...current.localConfig,
          ...patch.localConfig,
          apiKey: preserveMaskedKey(patch.localConfig.apiKey, current.localConfig.apiKey),
        }
      : current.localConfig,
    externalConfig: patch.externalConfig
      ? {
          ...current.externalConfig,
          ...patch.externalConfig,
          apiKey: preserveMaskedKey(patch.externalConfig.apiKey, current.externalConfig.apiKey),
        }
      : current.externalConfig,
    searchConfig: patch.searchConfig
      ? {
          ...current.searchConfig,
          ...patch.searchConfig,
          apiKey: preserveMaskedKey(patch.searchConfig.apiKey, current.searchConfig.apiKey),
        }
      : current.searchConfig,
  } as unknown as Record<string, unknown>);

  memorySettings = saveStoredUserSettings(next);
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(memorySettings, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.chmodSync(SETTINGS_FILE, 0o600);
  } catch {
    // Graceful fallback in read-only environments
  }
  return memorySettings;
}
