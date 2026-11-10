import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';

export interface JavaInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  majorVersion: number | null;
}

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const RUNTIME_DIR = path.join(GROM_DIR, 'runtime');

const JAVA_MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

export function findJava(minimumMajorVersion?: number): JavaInfo {
  const paths: string[] = [];
  if (fs.existsSync(RUNTIME_DIR)) {
    for (const dir of fs.readdirSync(RUNTIME_DIR)) {
      const javaPath = path.join(RUNTIME_DIR, dir, 'bin', 'java.exe');
      if (fs.existsSync(javaPath)) paths.push(javaPath);
    }
  }

  if (process.env.JAVA_HOME) paths.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));

  const programFiles = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\Microsoft\\jdk',
    'C:\\Program Files\\BellSoft',
  ];
  for (const dir of programFiles) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const sub of fs.readdirSync(dir)) {
        const javaPath = path.join(dir, sub, 'bin', 'java.exe');
        if (fs.existsSync(javaPath)) paths.push(javaPath);
      }
    } catch { /* Ignore inaccessible installation folders. */ }
  }
  paths.push('java');

  const seen = new Set<string>();
  const found: JavaInfo[] = [];
  for (const javaPath of paths) {
    const identity = javaPath.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    try {
      if (javaPath !== 'java' && !fs.existsSync(javaPath)) continue;
      const output = execSync(`\"${javaPath}\" -version 2>&1`, { encoding: 'utf-8', timeout: 5000 });
      const majorVersion = parseJavaMajorVersion(output);
      if (!majorVersion) continue;
      found.push({
        found: true,
        path: javaPath,
        version: output.split('\n')[0].trim(),
        majorVersion,
      });
    } catch { /* Try the next possible Java installation. */ }
  }

  if (!found.length) return { found: false, path: null, version: null, majorVersion: null };
  if (minimumMajorVersion) {
    const compatible = found.filter((item) => (item.majorVersion || 0) >= minimumMajorVersion)
      .sort((a, b) => (a.majorVersion || 0) - (b.majorVersion || 0));
    if (compatible.length) return compatible[0];
  }
  // Prefer the first configured runtime when none met a requested minimum.
  return found[0];
}

export function getRequiredJavaVersion(mcVersion: string, versionMetadata?: any): number {
  // The version JSON supplied by Mojang is authoritative and also handles snapshots/legacy IDs.
  const declaredMajor = Number(versionMetadata?.javaVersion?.majorVersion);
  if (Number.isInteger(declaredMajor) && declaredMajor >= 8 && declaredMajor <= 99) return declaredMajor;
  const component = String(versionMetadata?.javaVersion?.component || '');
  const componentMajor: Record<string, number> = {
    'jre-legacy': 8,
    'java-runtime-alpha': 16,
    'java-runtime-beta': 17,
    'java-runtime-gamma': 17,
    'java-runtime-delta': 21,
    'java-runtime-epsilon': 25,
  };
  if (componentMajor[component]) return componentMajor[component];

  const id = String(mcVersion || '').trim();
  // Classic, Indev, Infdev, Alpha and Beta releases use the legacy Java 8 runtime fallback.
  if (/^(?:a\d|b\d|rd-|inf-|c0\.|classic|indev|preclassic|3d shareware)/i.test(id)) return 8;

  // Minecraft switched to Java 25 for the 26.x line. Keep the multi-digit major intact.
  const match = id.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return 8;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] || 0);

  if (major >= 26) return 25;
  if (major === 1) {
    if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
    if (minor >= 18) return 17;
    if (minor === 17) return 16;
    return 8;
  }
  return major >= 2 ? 21 : 8;
}

function javaMajorFromRuntimeName(name: unknown): number | null {
  const value = String(name || '').trim();
  if (!value) return null;
  const legacy = value.match(/^1\.(\d+)(?:[._+-]|$)/);
  if (legacy) return Number(legacy[1]);
  const modern = value.match(/^(\d+)(?:[._+-]|u|$)/i);
  return modern ? Number(modern[1]) : null;
}

function parseJavaMajorVersion(output: string): number | null {
  const quoted = output.match(/version\s+"([^"]+)"/i)?.[1];
  const unquoted = output.match(/openjdk\s+([0-9][^\s]*)/i)?.[1];
  const value = quoted || unquoted;
  if (!value) return null;
  const legacy = value.match(/^1\.(\d+)/);
  if (legacy) return Number(legacy[1]);
  const modern = value.match(/^(\d+)/);
  return modern ? Number(modern[1]) : null;
}

const activeRuntimeDownloads = new Map<number, Promise<string>>();

export function downloadJavaRuntime(
  requiredVersion: number,
  onProgress?: (msg: string, percent: number) => void
): Promise<string> {
  const existing = activeRuntimeDownloads.get(requiredVersion);
  if (existing) {
    onProgress?.(`Установка Java ${requiredVersion} уже выполняется...`, 5);
    return existing;
  }

  const task = downloadJavaRuntimeCore(requiredVersion, onProgress);
  activeRuntimeDownloads.set(requiredVersion, task);
  void task.then(
    () => { if (activeRuntimeDownloads.get(requiredVersion) === task) activeRuntimeDownloads.delete(requiredVersion); },
    () => { if (activeRuntimeDownloads.get(requiredVersion) === task) activeRuntimeDownloads.delete(requiredVersion); },
  );
  return task;
}

async function downloadJavaRuntimeCore(
  requiredVersion: number,
  onProgress?: (msg: string, percent: number) => void
): Promise<string> {
  onProgress?.('Получение манифеста Java от Mojang...', 0);

  const manifest = await httpsGetJson(JAVA_MANIFEST);
  const windowsRuntimes = manifest['windows-x64'];

  if (!windowsRuntimes) throw new Error('Манифест Java для Windows не найден');

  const preferredComponents: Record<number, string[]> = {
    8: ['jre-legacy'],
    16: ['java-runtime-alpha'],
    17: ['java-runtime-gamma', 'java-runtime-beta'],
    21: ['java-runtime-delta', 'java-runtime-gamma'],
    25: ['java-runtime-epsilon'],
  };
  const preferred = preferredComponents[requiredVersion] || [];
  const candidates: Array<{ name: string; entry: any; order: number }> = [];
  let order = 0;
  for (const [name, entries] of Object.entries(windowsRuntimes) as Array<[string, any[]]>) {
    for (const entry of entries || []) {
      if (javaMajorFromRuntimeName(entry?.version?.name) === requiredVersion && entry?.manifest?.url) {
        candidates.push({ name, entry, order: order++ });
      }
    }
  }
  candidates.sort((a, b) => {
    const aPriority = preferred.indexOf(a.name) < 0 ? Number.MAX_SAFE_INTEGER : preferred.indexOf(a.name);
    const bPriority = preferred.indexOf(b.name) < 0 ? Number.MAX_SAFE_INTEGER : preferred.indexOf(b.name);
    return aPriority - bPriority || a.order - b.order;
  });
  const selected = candidates[0];
  const targetRuntime = selected?.name;
  const runtimeEntry = selected?.entry;

  if (!targetRuntime || !runtimeEntry) {
    throw new Error(`В манифесте Mojang не найден runtime Java ${requiredVersion} для Windows x64. Проверь интернет и обнови лаунчер.`);
  }
  onProgress?.(`Скачивание Java ${requiredVersion}...`, 5);

  const runtimeDir = path.join(RUNTIME_DIR, targetRuntime);
  fs.mkdirSync(runtimeDir, { recursive: true });

  const filesManifest = await httpsGetJson(runtimeEntry.manifest.url);
  const files = filesManifest.files;

  let downloaded = 0;
  const total = Object.keys(files).length;

  for (const [filePath, fileInfo] of Object.entries(files) as any) {
    if (fileInfo.type === 'directory') {
      fs.mkdirSync(path.join(runtimeDir, filePath), { recursive: true });
      continue;
    }
    if (fileInfo.type === 'file') {
      const destPath = path.join(runtimeDir, filePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const raw = fileInfo.downloads?.raw;
      if (!raw?.url) continue;
      await httpsDownload(raw.url, destPath, raw.sha1, raw.size);
      downloaded++;
      const percent = Math.round(5 + (downloaded / total) * 90);
      onProgress?.(`Загрузка Java: ${downloaded}/${total}`, percent);
    }
  }

  onProgress?.('Java установлена', 100);

  let javaExe = path.join(runtimeDir, 'bin', 'java.exe');
  if (!fs.existsSync(javaExe)) {
    const found = findJavaExeRecursive(runtimeDir);
    if (found) javaExe = found;
    else throw new Error('java.exe не найден');
  }
  const actualMajor = readJavaMajorVersion(javaExe);
  if (actualMajor !== requiredVersion) {
    throw new Error(`Mojang runtime скачан, но версия Java оказалась ${actualMajor ?? 'неизвестной'}, а нужна ${requiredVersion}. Удали папку ${runtimeDir} и повтори скачивание.`);
  }
  return javaExe;
}

function findJavaExeRecursive(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findJavaExeRecursive(fullPath);
      if (found) return found;
    } else if (entry.name === 'java.exe') {
      return fullPath;
    }
  }
  return null;
}

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          let data = '';
          res2.on('data', (chunk) => (data += chunk));
          res2.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
      } else {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }
    }).on('error', reject);
  });
}

function runtimeFileMatches(filePath: string, expectedSha1?: string, expectedSize?: number): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return false;
    if (typeof expectedSize === 'number' && expectedSize > 0 && stat.size !== expectedSize) return false;
    if (expectedSha1) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
      if (hash.toLowerCase() !== expectedSha1.toLowerCase()) return false;
    }
    return true;
  } catch { return false; }
}

function readJavaMajorVersion(javaPath: string): number | null {
  try {
    const output = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf-8', timeout: 8000 });
    return parseJavaMajorVersion(output);
  } catch { return null; }
}

function httpsDownload(url: string, dest: string, expectedSha1?: string, expectedSize?: number, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (runtimeFileMatches(dest, expectedSha1, expectedSize)) return resolve();
    if (redirects > 8) return reject(new Error(`Слишком много перенаправлений для ${url}`));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tempPath = `${dest}.gromtmp-${process.pid}`;
    try { fs.rmSync(tempPath, { force: true }); } catch {}

    const req = https.get(url, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        try { fs.rmSync(tempPath, { force: true }); } catch {}
        httpsDownload(new URL(res.headers.location, url).toString(), dest, expectedSha1, expectedSize, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status} при загрузке Java runtime`));
        return;
      }

      const file = fs.createWriteStream(tempPath);
      res.on('error', (err) => { file.destroy(); try { fs.rmSync(tempPath, { force: true }); } catch {} reject(err); });
      file.on('error', (err) => { try { fs.rmSync(tempPath, { force: true }); } catch {} reject(err); });
      file.on('finish', () => {
        file.close((closeErr) => {
          if (closeErr) { try { fs.rmSync(tempPath, { force: true }); } catch {} reject(closeErr); return; }
          if (!runtimeFileMatches(tempPath, expectedSha1, expectedSize)) {
            try { fs.rmSync(tempPath, { force: true }); } catch {}
            reject(new Error(`Проверка целостности Java runtime не пройдена: ${path.basename(dest)}`));
            return;
          }
          try {
            fs.rmSync(dest, { force: true });
            fs.renameSync(tempPath, dest);
            resolve();
          } catch (err) { try { fs.rmSync(tempPath, { force: true }); } catch {} reject(err); }
        });
      });
      res.pipe(file);
    });
    req.setTimeout(45_000, () => req.destroy(new Error(`Тайм-аут при скачивании Java runtime: ${path.basename(dest)}`)));
    req.on('error', (err) => { try { fs.rmSync(tempPath, { force: true }); } catch {} reject(err); });
  });
}
