import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const distDir = path.join(rootDir, 'dist');
const bundlePath = path.join(buildDir, 'sea-server.cjs');
const seaConfigPath = path.join(buildDir, 'sea-config.json');
const blobPath = path.join(buildDir, 'sea-prep.blob');
const injectScriptPath = path.join(buildDir, 'inject-sea.ps1');
const outputExePath = path.join(rootDir, 'CivicLead.exe');

function collectFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPosix = path.relative(baseDir, fullPath).split(path.sep).join('/');
      files.push({ key: relPosix, fullPath });
    }
  }
  return files;
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('scripts/build-exe.mjs targets Windows (win32) PE executable packaging.');
  }

  fs.mkdirSync(buildDir, { recursive: true });

  console.log('[1/5] Building frontend assets with Vite...');
  const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  execFileSync(process.execPath, [viteCli, 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Vite build did not produce dist/index.html');
  }

  console.log('[2/5] Bundling backend server into build/sea-server.cjs...');
  await esbuild({
    entryPoints: [path.join(rootDir, 'server.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['vite', 'node:*'],
    logLevel: 'info',
  });

  console.log('[3/5] Generating Node SEA preparation blob...');
  const distFiles = collectFiles(distDir);
  const assets = {};
  for (const file of distFiles) {
    assets[file.key] = path.relative(rootDir, file.fullPath).split(path.sep).join('/');
  }

  const seaConfig = {
    main: path.relative(rootDir, bundlePath).split(path.sep).join('/'),
    output: path.relative(rootDir, blobPath).split(path.sep).join('/'),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    assets,
  };
  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');

  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  console.log('[4/5] Copying Node runtime and injecting SEA blob into CivicLead.exe...');
  fs.copyFileSync(process.execPath, outputExePath);

  const psScript = `param(
  [Parameter(Mandatory=$true)][string]$ExePath,
  [Parameter(Mandatory=$true)][string]$BlobPath
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class CivicLeadSeaInjector {
    [DllImport("imagehlp.dll", SetLastError = true)]
    private static extern bool ImageRemoveCertificate(IntPtr FileHandle, int Index);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr BeginUpdateResourceW(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool UpdateResourceW(IntPtr hUpdate, IntPtr lpType, string lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResourceW(IntPtr hUpdate, bool fDiscard);

    public static void Inject(string exePath, string blobPath) {
        using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) {
            ImageRemoveCertificate(fs.SafeFileHandle.DangerousGetHandle(), 0);
        }

        byte[] exeBytes = File.ReadAllBytes(exePath);
        byte[] needle = Encoding.ASCII.GetBytes("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0");
        int found = -1;
        for (int i = 0; i <= exeBytes.Length - needle.Length; i++) {
            bool match = true;
            for (int j = 0; j < needle.Length; j++) {
                if (exeBytes[i + j] != needle[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                found = i;
                break;
            }
        }
        if (found == -1) {
            throw new Exception("NODE_SEA_FUSE sentinel not found in copied Node executable.");
        }
        exeBytes[found + needle.Length - 1] = 0x31;
        File.WriteAllBytes(exePath, exeBytes);

        byte[] blobBytes = File.ReadAllBytes(blobPath);
        IntPtr hUpdate = BeginUpdateResourceW(exePath, false);
        if (hUpdate == IntPtr.Zero) {
            throw new Exception("BeginUpdateResourceW failed with Win32 error " + Marshal.GetLastWin32Error());
        }
        if (!UpdateResourceW(hUpdate, (IntPtr)10, "NODE_SEA_BLOB", 1033, blobBytes, (uint)blobBytes.Length)) {
            throw new Exception("UpdateResourceW failed with Win32 error " + Marshal.GetLastWin32Error());
        }
        if (!EndUpdateResourceW(hUpdate, false)) {
            throw new Exception("EndUpdateResourceW failed with Win32 error " + Marshal.GetLastWin32Error());
        }
    }
}
"@

[CivicLeadSeaInjector]::Inject($ExePath, $BlobPath)
`;

  fs.writeFileSync(injectScriptPath, psScript, 'utf8');
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', injectScriptPath, outputExePath, blobPath],
    { cwd: rootDir, stdio: 'inherit' }
  );

  console.log('[5/5] Verifying CivicLead.exe...');
  const stat = fs.statSync(outputExePath);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`Built ${outputExePath} (${sizeMb} MB, ${distFiles.length} embedded frontend assets).`);
}

main().catch((err) => {
  console.error('Failed to build CivicLead.exe:', err);
  process.exit(1);
});
