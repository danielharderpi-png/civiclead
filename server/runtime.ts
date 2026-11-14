import { execFile } from 'node:child_process';
import path from 'node:path';

type SeaModule = typeof import('node:sea');

let cachedAssetKeys: Set<string> | null = null;

export function getSeaModule(): SeaModule | null {
  try {
    if (typeof process.getBuiltinModule === 'function') {
      return (process.getBuiltinModule('node:sea') as SeaModule | undefined) ?? null;
    }
  } catch {
    // node:sea unavailable
  }
  return null;
}

export function isSeaRuntime(): boolean {
  try {
    return Boolean(getSeaModule()?.isSea());
  } catch {
    return false;
  }
}

export function getAppBaseDir(): string {
  return isSeaRuntime() ? path.dirname(process.execPath) : process.cwd();
}

function getAssetKeySet(): Set<string> | null {
  if (!isSeaRuntime()) return null;
  if (cachedAssetKeys) return cachedAssetKeys;
  const sea = getSeaModule();
  if (!sea) return null;
  try {
    cachedAssetKeys = new Set(sea.getAssetKeys());
    return cachedAssetKeys;
  } catch {
    return null;
  }
}

export function hasEmbeddedAssets(): boolean {
  const keys = getAssetKeySet();
  return Boolean(keys?.has('index.html'));
}

export function getEmbeddedAsset(assetKey: string): Buffer | null {
  const keys = getAssetKeySet();
  if (!keys) return null;
  const normalized = assetKey.replace(/^\/+/, '');
  if (!normalized || !keys.has(normalized)) return null;
  const sea = getSeaModule();
  if (!sea) return null;
  try {
    return Buffer.from(sea.getRawAsset(normalized));
  } catch {
    return null;
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function openBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('open', [url], () => {});
    } else {
      execFile('xdg-open', [url], () => {});
    }
  } catch {
    // Ignore errors in headless environments
  }
}
