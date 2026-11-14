import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_USER_SETTINGS,
  normalizeUserSettings,
  type UserSettings,
} from '../src/shared/types.ts';
import { getStoredUserSettings, saveStoredUserSettings } from './db.ts';

const SETTINGS_FILE = path.resolve(process.cwd(), 'user-settings.json');

let memorySettings: UserSettings | null = null;

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
    localConfig: patch.localConfig
      ? { ...current.localConfig, ...patch.localConfig }
      : current.localConfig,
    externalConfig: patch.externalConfig
      ? { ...current.externalConfig, ...patch.externalConfig }
      : current.externalConfig,
    searchConfig: patch.searchConfig
      ? { ...current.searchConfig, ...patch.searchConfig }
      : current.searchConfig,
  } as unknown as Record<string, unknown>);

  memorySettings = saveStoredUserSettings(next);
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(memorySettings, null, 2), 'utf8');
  } catch {
    // Graceful fallback in read-only environments
  }
  return memorySettings;
}
