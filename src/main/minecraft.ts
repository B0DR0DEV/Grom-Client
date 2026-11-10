import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findJava, getRequiredJavaVersion, downloadJavaRuntime } from './java';
import { getAikarFlags } from './fpsBoost';
import { ChildProcess } from 'node:child_process';
import AdmZip from 'adm-zip';

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_MAVEN = 'https://maven.fabricmc.net/';

function httpsGetJson(url: string, redirects = 0): Promise<any> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Слишком много перенаправлений при получении данных Minecraft'));
    const req = https.get(url, { headers: { 'User-Agent': 'GromClient/1.4.4' } }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        httpsGetJson(nextUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Сервер вернул HTTP ${status} для ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error(`Не удалось прочитать JSON: ${url}`)); }
      });
      res.on('error', reject);
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Тайм-аут при получении данных Minecraft')));
    req.on('error', reject);
  });
}

function fileMatches(dest: string, expectedSha1?: string, expectedSize?: number): boolean {
  try {
    const stat = fs.statSync(dest);
    if (!stat.isFile() || stat.size <= 0) return false;
    if (typeof expectedSize === 'number' && expectedSize > 0 && stat.size !== expectedSize) return false;
    if (expectedSha1) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex');
      if (hash.toLowerCase() !== expectedSha1.toLowerCase()) return false;
    }
    return true;
  } catch {
    return false;
  }
}


function minecraftLibraryIsAllowed(lib: any): boolean {
  const rules = lib?.rules;
  if (!Array.isArray(rules) || rules.length === 0) return true;
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  let allowed = false; // Libraries with rules default to disallowed; matching rules override in order.
  for (const rule of rules) {
    if (rule.os?.name && rule.os.name !== osName) continue;
    if (rule.os?.arch) {
      try { if (!new RegExp(rule.os.arch).test(process.arch)) continue; }
      catch { continue; }
    }
    if (rule.os?.version) {
      try { if (!new RegExp(rule.os.version).test(os.release())) continue; }
      catch { continue; }
    }
    if (rule.features && Object.entries(rule.features).some(([key, value]) => {
      const supported: Record<string, boolean> = { is_demo_user: false, has_custom_resolution: true, has_quick_plays_support: false };
      return (supported[key] ?? false) !== Boolean(value);
    })) continue;
    if (rule.action === 'allow') allowed = true;
    else if (rule.action === 'disallow') allowed = false;
  }
  return allowed;
}

function downloadAttempt(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Слишком много перенаправлений при скачивании файла'));
    const req = https.get(url, { headers: { 'User-Agent': 'GromClient/1.4.4' } }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        downloadAttempt(new URL(res.headers.location, url).toString(), dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}: ${url}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.on('error', (err) => { file.destroy(); reject(err); });
      file.on('error', reject);
      file.on('finish', () => file.close((err) => err ? reject(err) : resolve()));
      res.pipe(file);
    });
    req.setTimeout(45_000, () => req.destroy(new Error(`Тайм-аут скачивания: ${url}`)));
    req.on('error', reject);
  });
}

async function httpsDownload(url: string, dest: string, expectedSha1?: string, expectedSize?: number): Promise<void> {
  if (fileMatches(dest, expectedSha1, expectedSize)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tempPath = `${dest}.grom-download-${process.pid}-${Date.now()}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      await downloadAttempt(url, tempPath);
      if (!fileMatches(tempPath, expectedSha1, expectedSize)) {
        throw new Error(expectedSha1
          ? `Контрольная сумма или размер скачанного файла не совпали: ${path.basename(dest)}`
          : `Скачанный файл пустой или имеет неправильный размер: ${path.basename(dest)}`);
      }
      fs.rmSync(dest, { force: true });
      fs.renameSync(tempPath, dest);
      return;
    } catch (err) {
      lastError = err;
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Не удалось скачать ${url}`);
}

const VERSION_MANIFEST_CACHE = path.join(os.homedir(), '.gromclient', 'version-manifest-cache.json');

export async function getMinecraftVersions(): Promise<string[]> {
  try {
    const manifest = await httpsGetJson(MOJANG_MANIFEST);
    const ids = Array.isArray(manifest?.versions) ? manifest.versions.map((v: any) => String(v.id)).filter(Boolean) : [];
    if (!ids.length) throw new Error('Пустой список версий Mojang');
    try {
      fs.mkdirSync(path.dirname(VERSION_MANIFEST_CACHE), { recursive: true });
      fs.writeFileSync(VERSION_MANIFEST_CACHE, JSON.stringify({ fetchedAt: Date.now(), versions: manifest.versions }), 'utf8');
    } catch { /* The live manifest is still usable if the cache cannot be saved. */ }
    return ids;
  } catch {
    // Use the last successfully downloaded complete manifest before falling back to a short offline list.
    try {
      const cached = JSON.parse(fs.readFileSync(VERSION_MANIFEST_CACHE, 'utf8'));
      const ids = Array.isArray(cached?.versions) ? cached.versions.map((v: any) => String(v.id)).filter(Boolean) : [];
      if (ids.length) return ids;
    } catch { /* No usable cache yet. */ }
    return [
      '26.3', '26.2', '26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
      '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.17.1', '1.16.5', '1.12.2', '1.8.9', '1.7.10',
      'b1.7.3', 'b1.8.1', 'a1.2.6', 'a1.1.2_01', 'inf-20100618', 'c0.30_01c', 'rd-132211', 'classic'
    ];
  }
}

/** Resolve the Java level from the official version JSON, including Alpha/Beta and snapshots. */
export async function getRequiredJavaForMinecraftVersion(mcVersion: string): Promise<number> {
  try {
    const manifest = await httpsGetJson(MOJANG_MANIFEST);
    const versionMeta = manifest.versions?.find((entry: any) => entry.id === mcVersion);
    if (versionMeta?.url) {
      const versionData = await httpsGetJson(versionMeta.url);
      return getRequiredJavaVersion(mcVersion, versionData);
    }
  } catch {
    // Use the legacy-ID/version-family fallback when Mojang metadata is temporarily unavailable.
  }
  return getRequiredJavaVersion(mcVersion);
}

export async function installMinecraft(
  version: string,
  gameDir: string,
  onProgress?: (msg: string, percent: number) => void
): Promise<void> {
  onProgress?.(`Получение данных версии ${version}...`, 0);

  const manifest = await httpsGetJson(MOJANG_MANIFEST);
  const versionMeta = manifest.versions.find((v: any) => v.id === version);
  if (!versionMeta) throw new Error(`Версия ${version} не найдена`);

  const versionData = await httpsGetJson(versionMeta.url);

  const versionDir = path.join(gameDir, 'versions', version);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${version}.json`), JSON.stringify(versionData, null, 2));

  if (!versionData.downloads?.client?.url) throw new Error(`Для версии ${version} нет ссылки на клиентский JAR`);
  onProgress?.(`Проверка и скачивание клиента ${version}...`, 10);
  await httpsDownload(versionData.downloads.client.url, path.join(versionDir, `${version}.jar`), versionData.downloads.client.sha1, versionData.downloads.client.size);

  onProgress?.(`Скачивание библиотек...`, 20);
  const libsDir = path.join(gameDir, 'libraries');
  const libraries = (versionData.libraries || []).filter((lib: any) =>
    minecraftLibraryIsAllowed(lib) && (lib.downloads?.artifact?.url || getWindowsNativeArtifact(lib, getWindowsNativeClassifier(lib)))
  );
  const totalLibs = libraries.length;
  let doneLibs = 0;

  for (const lib of libraries) {
    if (lib.downloads?.artifact?.url) {
      await httpsDownload(
        lib.downloads.artifact.url,
        path.join(libsDir, lib.downloads.artifact.path || mavenNameToPath(lib.name)),
        lib.downloads.artifact.sha1,
        lib.downloads.artifact.size,
      );
    }

    const nativeClassifier = getWindowsNativeClassifier(lib);
    const nativeArtifact = getWindowsNativeArtifact(lib, nativeClassifier);
    if (nativeArtifact?.url) {
      await httpsDownload(nativeArtifact.url, path.join(libsDir, nativeArtifact.path || mavenNameToPath(lib.name, nativeClassifier || undefined)), nativeArtifact.sha1, nativeArtifact.size);
    }

    doneLibs++;
    const percent = 20 + Math.round((doneLibs / totalLibs) * 70);
    onProgress?.(`Библиотеки: ${doneLibs}/${totalLibs}`, percent);
  }

  const assetIndexMeta = versionData.assetIndex;
  if (assetIndexMeta?.id && assetIndexMeta?.url) {
    onProgress?.(`Проверка и скачивание ресурсов...`, 95);
    const assetsDir = path.join(gameDir, 'assets');
    const indexDir = path.join(assetsDir, 'indexes');
    fs.mkdirSync(indexDir, { recursive: true });
    const indexPath = path.join(indexDir, `${assetIndexMeta.id}.json`);
    await httpsDownload(assetIndexMeta.url, indexPath, assetIndexMeta.sha1, assetIndexMeta.size);

    onProgress?.('Загрузка списка ассетов...', 96);
    let indexData: any;
    try { indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); }
    catch {
      fs.rmSync(indexPath, { force: true });
      await httpsDownload(assetIndexMeta.url, indexPath, assetIndexMeta.sha1, assetIndexMeta.size);
      indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
    if (!indexData.objects || typeof indexData.objects !== 'object') throw new Error(`Список ресурсов для ${version} повреждён`);
    const objects = Object.entries(indexData.objects) as [string, any][];
    const objectsDir = path.join(assetsDir, 'objects');
    let doneObjects = 0;
    const CONCURRENT = 20;

    for (let i = 0; i < objects.length; i += CONCURRENT) {
      const batch = objects.slice(i, i + CONCURRENT);
      await Promise.all(batch.map(async ([, obj]) => {
        const hash = obj.hash;
        const subDir = hash.substring(0, 2);
        const destPath = path.join(objectsDir, subDir, hash);
        const url = `https://resources.download.minecraft.net/${subDir}/${hash}`;
        await httpsDownload(url, destPath, hash, obj.size);
        doneObjects++;
      }));
      const percent = 96 + Math.round((doneObjects / Math.max(1, objects.length)) * 4);
      onProgress?.(`Ассеты: ${doneObjects}/${objects.length}`, percent);
    }

    // Legacy metadata can request virtual assets by its top-level `assets` id
    // even when assetIndex.virtual/map_to_resources are not included in the version JSON.
    const assetIndex = versionData.assetIndex || {};
    const legacyVirtualAssets = typeof versionData.assets === 'string' && /^(?:pre-|legacy$)/i.test(versionData.assets);
    if (assetIndex.virtual || assetIndex.map_to_resources || legacyVirtualAssets) {
      const mirrorRoot = assetIndex.virtual || legacyVirtualAssets
        ? path.join(assetsDir, 'virtual', assetIndex.id || versionData.assets)
        : path.join(assetsDir, 'resources');
      for (const [assetName, obj] of objects) {
        const objectPath = path.join(objectsDir, String(obj.hash).slice(0, 2), String(obj.hash));
        const mirrorPath = path.join(mirrorRoot, ...assetName.split(/[\\/]/));
        if (!fileMatches(objectPath, obj.hash, obj.size)) {
          throw new Error(`Не найден ресурс Minecraft: ${assetName}`);
        }
        if (!fileMatches(mirrorPath, obj.hash, obj.size)) {
          fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
          const tempMirror = `${mirrorPath}.grom-copy-${process.pid}`;
          fs.copyFileSync(objectPath, tempMirror);
          fs.rmSync(mirrorPath, { force: true });
          fs.renameSync(tempMirror, mirrorPath);
        }
      }
    }
  } else {
    onProgress?.(`У версии ${version} нет отдельного asset-index; пропускаю каталог ресурсов`, 98);
  }

  onProgress?.(`Minecraft ${version} установлен`, 100);
}

export interface LaunchOptions {
  nickname: string;
  version: string;
  loader: string;
  gameDir: string;
  ram: number;
  width: number;
  height: number;
  fullscreen: boolean;
  fpsBoost?: boolean;
  server?: string;
  /** Per-instance working dir (mods/saves/config). Libraries and assets stay in gameDir. */
  runDir?: string;
  auth?: { uuid: string; accessToken: string };
  onProgress?: (msg: string, percent: number) => void;
}

function findLoaderVersion(gameDir: string, mcVersion: string, loader: string): { id: string; jsonPath: string } | null {
  const versionsDir = path.join(gameDir, 'versions');
  if (!fs.existsSync(versionsDir)) return null;

  const dirs = fs.readdirSync(versionsDir);
  let candidates: string[] = [];

  if (loader === 'Fabric') {
    candidates = dirs.filter((d) => d.startsWith('fabric-loader-') && d.endsWith(`-${mcVersion}`));
  } else if (loader === 'Forge') {
    candidates = dirs.filter((d) => d.startsWith(`${mcVersion}-forge-`));
  } else if (loader === 'NeoForge') {
    candidates = dirs.filter((d) => d.startsWith('neoforge-'));
  } else {
    return null;
  }

  if (candidates.length === 0) return null;

  const versionId = candidates[candidates.length - 1];
  const jsonPath = path.join(versionsDir, versionId, `${versionId}.json`);
  if (!fs.existsSync(jsonPath)) return null;

  return { id: versionId, jsonPath };
}

function resolveVersionJson(gameDir: string, versionId: string): any {
  const versionDir = path.join(gameDir, 'versions', versionId);
  const jsonPath = path.join(versionDir, `${versionId}.json`);

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON версии ${versionId} не найден`);
  }

  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  if (!json.inheritsFrom) {
    return { ...json, _versionDir: versionDir };
  }

  const parentJson = resolveVersionJson(gameDir, json.inheritsFrom);

  const parentLibraries = parentJson.libraries || [];
  const childLibraries = json.libraries || [];
  const childCoordinates = new Set(childLibraries.map((lib: any) => {
    const parts = String(lib.name || '').split(':');
    return `${parts[0]}:${parts[1]}`;
  }));
  const merged = {
    ...parentJson,
    ...json,
    id: versionId,
    mainClass: json.mainClass || parentJson.mainClass,
    libraries: [...parentLibraries.filter((lib: any) => {
      const parts = String(lib.name || '').split(':');
      return !childCoordinates.has(`${parts[0]}:${parts[1]}`);
    }), ...childLibraries],
    assetIndex: json.assetIndex || parentJson.assetIndex,
    assets: json.assets || parentJson.assets,
    downloads: json.downloads || parentJson.downloads,
    arguments: {
      game: [...(parentJson.arguments?.game || []), ...(json.arguments?.game || [])],
      jvm: [...(parentJson.arguments?.jvm || []), ...(json.arguments?.jvm || [])],
    },
    _versionDir: versionDir,
    _parentVersionDir: parentJson._versionDir,
  };

  return merged;
}

function mavenNameToPath(name: string, classifier?: string): string {
  const parts = name.split(':');
  const group = parts[0].replace(/\./g, '/');
  const artifact = parts[1];
  const version = parts[2];

  let fileName = `${artifact}-${version}`;
  if (classifier) fileName += `-${classifier}`;
  fileName += '.jar';

  return `${group}/${artifact}/${version}/${fileName}`;
}

const LWJGL_MODULES_WITH_WINDOWS_NATIVES = new Set([
  'lwjgl',
  'lwjgl-glfw',
  'lwjgl-jemalloc',
  'lwjgl-openal',
  'lwjgl-opengl',
  'lwjgl-stb',
  'lwjgl-tinyfd',
  'lwjgl-freetype',
  'lwjgl-vma',
  // Minecraft 26.3 uses these optional LWJGL modules during native bootstrap.
  // Their Java artifacts can be present even when a manifest omits Windows classifiers.
  'lwjgl-sdl',
  'lwjgl-shaderc',
  'lwjgl-spvc',
  'lwjgl-spng',
]);

function knownLwjglWindowsClassifier(lib: any): string | null {
  if (process.platform !== 'win32') return null;
  const [group, artifact, version] = String(lib?.name || '').split(':');
  // Do not infer a Windows native JAR for every org.lwjgl module. In particular,
  // lwjgl-vulkan 3.4.3 has no Windows native artifact in the game metadata.
  if (group !== 'org.lwjgl' || !LWJGL_MODULES_WITH_WINDOWS_NATIVES.has(artifact) || !/^3\./.test(version || '')) return null;
  return process.arch === 'arm64'
    ? 'natives-windows-arm64'
    : process.arch === 'ia32'
      ? 'natives-windows-x86'
      : 'natives-windows';
}

function getWindowsNativeClassifier(lib: any): string | null {
  if (process.platform !== 'win32') return null;

  const classifiers = lib?.downloads?.classifiers;
  const names = classifiers && typeof classifiers === 'object' ? Object.keys(classifiers) : [];
  const declared = String(lib?.natives?.windows || '');
  const legacyArch = process.arch === 'ia32' ? '32' : process.arch === 'arm64' ? 'arm64' : '64';
  const expanded = declared.replace(/\$\{arch\}/g, legacyArch);

  // Prefer the version manifest whenever it explicitly names a Windows native.
  if (declared && names.includes(expanded)) return expanded;

  const windowsNativeNames = names.filter((name) => /^(?:natives[-_]windows|windows)(?:$|[-_])/i.test(name));
  if (windowsNativeNames.length) {
    const archAliases = process.arch === 'arm64'
      ? ['arm64', 'aarch64']
      : process.arch === 'ia32'
        ? ['32', 'x86', 'i386']
        : ['64', 'x86_64', 'amd64'];

    for (const arch of archAliases) {
      const escapedArch = arch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = windowsNativeNames.find((name) =>
        new RegExp(`(?:^|[-_])${escapedArch}(?:$|[-_])`, 'i').test(name)
      );
      if (match) return match;
    }

    // `natives-windows` is the x64 default in standard LWJGL Maven coordinates.
    const generic = windowsNativeNames.find((name) => /^natives[-_]windows$/i.test(name) || /^windows$/i.test(name));
    if (generic && process.arch !== 'arm64' && process.arch !== 'ia32') return generic;

    const compatible = windowsNativeNames.find((name) => !/(arm64|aarch64|natives[-_]windows[-_](?:32|x86)(?:$|[-_]))/i.test(name));
    if (compatible) return compatible;
    return null;
  }

  // Some Mojang version manifests contain the regular LWJGL artifact plus only non-Windows
  // classifiers (or no classifiers at all). Restore the known Windows natives used by Minecraft,
  // but never infer native downloads for arbitrary modules such as lwjgl-vulkan.
  if (declared) return expanded;
  return knownLwjglWindowsClassifier(lib);
}

function getWindowsNativeArtifact(lib: any, classifier: string | null): any | null {
  if (!classifier || !lib?.name) return null;
  const classifierMap = lib?.downloads?.classifiers;
  const classifierNames = classifierMap && typeof classifierMap === 'object' ? Object.keys(classifierMap) : [];
  const metadataArtifact = classifierMap && typeof classifierMap === 'object'
    ? classifierMap[classifier]
    : null;
  if (metadataArtifact?.url) {
    return {
      ...metadataArtifact,
      path: metadataArtifact.path || mavenNameToPath(lib.name, classifier),
    };
  }

  // Do not guess when the manifest lists Windows classifiers but omits the selected artifact.
  // A standard Maven fallback is used only for a declared Windows classifier or a specifically
  // whitelisted LWJGL module whose manifest has no Windows classifier. This prevents the 26.3
  // HTTP 404 for lwjgl-vulkan-*-natives-windows.jar while restoring LWJGL natives for 1.21.11.
  const hasWindowsClassifier = classifierNames.some((name) => /^(?:natives[-_]windows|windows)(?:$|[-_])/i.test(name));
  const declared = String(lib?.natives?.windows || '').replace(/\$\{arch\}/g, process.arch === 'ia32' ? '32' : process.arch === 'arm64' ? 'arm64' : '64');
  const explicitlyDeclared = Boolean(declared && classifier === declared);
  const knownFallback = Boolean(knownLwjglWindowsClassifier(lib) && classifier === knownLwjglWindowsClassifier(lib));
  if (hasWindowsClassifier || (!explicitlyDeclared && !knownFallback)) return null;

  const relPath = mavenNameToPath(String(lib.name), classifier);
  const baseUrl = String(lib.url || (String(lib.name).startsWith('net.fabricmc:') ? FABRIC_MAVEN : 'https://libraries.minecraft.net/'));
  return {
    path: relPath,
    url: `${baseUrl.replace(/\/+$/, '')}/${relPath}`,
  };
}

async function ensureLibraryDownloaded(
  gameDir: string,
  lib: any
): Promise<{ classpath: string[]; natives: string[] }> {
  const libsDir = path.join(gameDir, 'libraries');
  const classpath: string[] = [];
  const natives: string[] = [];

  if (lib.downloads?.artifact?.url) {
    const artifactPath = lib.downloads.artifact.path || (lib.name ? mavenNameToPath(lib.name) : '');
    if (artifactPath) {
      const destPath = path.join(libsDir, artifactPath);
      await httpsDownload(lib.downloads.artifact.url, destPath, lib.downloads.artifact.sha1, lib.downloads.artifact.size);
      classpath.push(destPath);
    }
  } else if (lib.name && !lib.downloads?.classifiers && !lib.natives?.windows) {
    // Fabric/loader libraries can omit download metadata entirely. A native-only entry with a
    // declared Windows classifier is not an ordinary classpath JAR and must not be downloaded
    // under the unclassified filename.
    const relPath = mavenNameToPath(lib.name);
    const destPath = path.join(libsDir, relPath);
    const baseUrl = lib.url || (String(lib.name).startsWith('net.fabricmc:') ? FABRIC_MAVEN : 'https://libraries.minecraft.net/');
    const downloadUrl = `${String(baseUrl).replace(/\/+$/, '')}/${relPath}`;
    try {
      await httpsDownload(downloadUrl, destPath);
    } catch (err: any) {
      throw new Error(`Не удалось получить библиотеку ${lib.name}: ${err.message}`);
    }
    classpath.push(destPath);
  }

  const nativeClassifier = getWindowsNativeClassifier(lib);
  const nativeArtifact = getWindowsNativeArtifact(lib, nativeClassifier);
  if (nativeArtifact?.url) {
    const destPath = path.join(libsDir, nativeArtifact.path || mavenNameToPath(lib.name, nativeClassifier || undefined));
    await httpsDownload(nativeArtifact.url, destPath, nativeArtifact.sha1, nativeArtifact.size);
    natives.push(destPath);
  }
  return { classpath, natives };
}

function extractNatives(nativesDir: string, nativeJars: string[], onProgress?: (msg: string, percent?: number) => void): void {
  // Only unpack the native JARs selected by this version's metadata. Scanning the global
  // libraries/ folder mixed old LWJGL DLLs with new versions (the user's 26.3 crash).
  fs.rmSync(nativesDir, { recursive: true, force: true });
  fs.mkdirSync(nativesDir, { recursive: true });
  let extracted = 0;
  const processed = new Set<string>();
  const selectedJars = [...new Set(nativeJars)];

  for (const jarPath of selectedJars) {
    if (!fileMatches(jarPath)) throw new Error(`Нативная библиотека отсутствует или повреждена: ${path.basename(jarPath)}`);
    try {
      const zip = new AdmZip(jarPath);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith('.dll')) continue;
        const fileName = path.basename(entry.entryName);
        if (!fileName || processed.has(fileName)) continue;
        processed.add(fileName);
        fs.writeFileSync(path.join(nativesDir, fileName), entry.getData());
        extracted++;
      }
    } catch (err: any) {
      throw new Error(`Не удалось распаковать нативы ${path.basename(jarPath)}: ${err.message}`);
    }
  }
  onProgress?.(`Распаковано ${extracted} DLL из ${selectedJars.length} нативных библиотек этой версии`, 19);
}

function offlinePlayerUuid(nickname: string): string {
  // Match Java UUID.nameUUIDFromBytes("OfflinePlayer:<name>") used by offline-mode servers.
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${nickname}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function launchMinecraft(
  options: LaunchOptions
): Promise<{ success: boolean; process?: ChildProcess; error?: string }> {
  const { onProgress } = options;

  // Install/verify the vanilla metadata first so that Java is selected from that exact
  // version's javaVersion declaration, rather than guessing from the visible version name.
  try {
    await installMinecraft(options.version, options.gameDir, onProgress);
  } catch (err: any) {
    return { success: false, error: `Не удалось подготовить Minecraft ${options.version}: ${err.message}` };
  }

  const vanillaDir = path.join(options.gameDir, 'versions', options.version);
  const vanillaJarPath = path.join(vanillaDir, `${options.version}.jar`);
  const vanillaJsonPath = path.join(vanillaDir, `${options.version}.json`);
  if (!fileMatches(vanillaJarPath) || !fileMatches(vanillaJsonPath)) {
    return { success: false, error: `Файлы Minecraft ${options.version} неполные. Повтори запуск, чтобы лаунчер докачал версию.` };
  }
  let vanillaMetadata: any = {};
  try { vanillaMetadata = JSON.parse(fs.readFileSync(vanillaJsonPath, 'utf-8')); } catch {}
  const required = getRequiredJavaVersion(options.version, vanillaMetadata);

  let java = findJava(required);
  if (!java.found || java.majorVersion !== required) {
    try {
      const javaPath = await downloadJavaRuntime(required, onProgress);
      const detectedMajor = getRequiredJavaVersion(options.version, vanillaMetadata);
      java = { found: true, path: javaPath, version: `Java ${detectedMajor}`, majorVersion: detectedMajor };
    } catch (err: any) {
      return { success: false, error: `Не удалось скачать Java ${required}: ${err.message}` };
    }
  }
  if (!java.path) return { success: false, error: 'Java не найдена' };
  if (java.majorVersion !== required) return { success: false, error: `Для Minecraft ${options.version} нужна Java ${required}, но выбран Java ${java.majorVersion || 'неизвестной версии'}. Повтори установку подходящего runtime.` };

  let versionIdToLaunch = options.version;

  if (options.loader && options.loader !== 'Vanilla') {
    const loaderVersion = findLoaderVersion(options.gameDir, options.version, options.loader);
    if (loaderVersion) {
      versionIdToLaunch = loaderVersion.id;
      onProgress?.(`Запуск ${options.loader} ${loaderVersion.id}`, 5);
    } else {
      return {
        success: false,
        error: `${options.loader} не установлен. Нажми «📥 Установить» рядом с загрузчиком.`
      };
    }
  }

  onProgress?.('Подготовка версии...', 10);
  const versionData = resolveVersionJson(options.gameDir, versionIdToLaunch);

  onProgress?.('Проверка библиотек...', 15);
  const classpath: string[] = [];
  const nativeJars: string[] = [];
  const seenClasspathModules = new Set<string>();
  const seenClasspathPaths = new Set<string>();
  const seenNativePaths = new Set<string>();

  const librariesToCheck = versionData.libraries || [];
  for (let index = 0; index < librariesToCheck.length; index++) {
    const lib = librariesToCheck[index];
    if (!minecraftLibraryIsAllowed(lib)) continue;
    const result = await ensureLibraryDownloaded(options.gameDir, lib);
    const nameParts = String(lib.name || '').split(':');
    const moduleKey = nameParts.length >= 2 ? `${nameParts[0]}:${nameParts[1]}` : String(lib.name || '');

    // Keep one classpath version per Maven module, but always process native classifiers from every
    // allowed manifest record. A prior record can supply the ordinary JAR while another same-module
    // record carries the platform-native JAR; skipping that second record caused lwjgl.dll to vanish.
    if (moduleKey && !seenClasspathModules.has(moduleKey) && result.classpath.length) {
      for (const entry of result.classpath) {
        const key = path.resolve(entry).toLowerCase();
        if (!seenClasspathPaths.has(key)) {
          seenClasspathPaths.add(key);
          classpath.push(entry);
        }
      }
      seenClasspathModules.add(moduleKey);
    }
    for (const entry of result.natives) {
      const key = path.resolve(entry).toLowerCase();
      if (!seenNativePaths.has(key)) {
        seenNativePaths.add(key);
        nativeJars.push(entry);
      }
    }
    if (index % 3 === 0 || index === librariesToCheck.length - 1) {
      const phasePercent = 15 + Math.round(((index + 1) / Math.max(1, librariesToCheck.length)) * 6);
      onProgress?.(`Проверка библиотек: ${index + 1}/${librariesToCheck.length}`, phasePercent);
    }
  }

  const clientJar = path.join(
    options.gameDir,
    'versions',
    options.version,
    `${options.version}.jar`
  );

  if (fileMatches(clientJar)) {
    classpath.push(clientJar);
  } else {
    return { success: false, error: `Клиентский JAR отсутствует или пустой: ${clientJar}. Повтори запуск, чтобы лаунчер докачал версию.` };
  }

  onProgress?.('Распаковка нативных библиотек...', 18);
  const nativesDir = path.join(options.gameDir, 'versions', versionIdToLaunch, `${versionIdToLaunch}-natives`);

  try {
    extractNatives(nativesDir, nativeJars, (msg, percent) => onProgress?.(msg, percent ?? 19));
  } catch (err: any) {
    return { success: false, error: `Не удалось подготовить нативные библиотеки для Minecraft ${options.version}: ${err.message}` };
  }
  if (process.platform === 'win32') {
    // Fail before starting Java if a version-specific native needed at bootstrap wasn't extracted.
    // This is particularly important for 26.3: SDL and SPVC are loaded before a window appears.
    const moduleNames = new Set<string>((versionData.libraries || [])
      .filter((lib: any) => minecraftLibraryIsAllowed(lib))
      .map((lib: any) => String(lib?.name || '').split(':')[1] || ''));
    const requiredNativeFiles = new Set<string>(['lwjgl.dll']);
    if (moduleNames.has('lwjgl-sdl')) requiredNativeFiles.add('SDL3.dll');
    if (moduleNames.has('lwjgl-spvc')) requiredNativeFiles.add('spirv-cross.dll');
    // LWJGL 3.4.3's Windows classifier used by Minecraft 26.3 contains shaderc.dll.
    // Accept shaderc_shared.dll as a compatibility name for other package builds, rather
    // than hard-failing when one valid variant is already present.
    const requiredNativeAlternatives: string[][] = [];
    if (moduleNames.has('lwjgl-shaderc')) requiredNativeAlternatives.push(['shaderc.dll', 'shaderc_shared.dll']);

    const missingNativeFiles = [...requiredNativeFiles].filter((file) => !fileMatches(path.join(nativesDir, file)));
    const missingNativeGroups = requiredNativeAlternatives
      .filter((alternatives) => !alternatives.some((file) => fileMatches(path.join(nativesDir, file))))
      .map((alternatives) => alternatives.join(' или '));
    const missingNativeRequirements = [...missingNativeFiles, ...missingNativeGroups];
    if (missingNativeRequirements.length) {
      const selected = nativeJars.map((jar) => path.basename(jar)).join(', ') || 'не выбраны';
      let extracted = '(не удалось прочитать папку)';
      try { extracted = fs.readdirSync(nativesDir).join(', ') || '(папка пуста)'; } catch {}
      const diagnostic = `Не найдены native DLL для Minecraft ${options.version}: ${missingNativeRequirements.join(', ')}. Native JARs: ${selected}. Файлы в natives: ${extracted}`;
      try {
        const logDir = path.join(options.gameDir, 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, 'launcher-debug.log'), `\n[${new Date().toISOString()}] [LAUNCHER ERROR] ${diagnostic}\n`);
      } catch {}
      return {
        success: false,
        error: `Не найдены необходимые DLL: ${missingNativeRequirements.join(', ')}. Игра не запущена. Проверь загрузку нативных библиотек для Minecraft ${options.version}; подробности записаны в logs/launcher-debug.log.`,
      };
    }
  }

  const sep = process.platform === 'win32' ? ';' : ':';
  const mainClass = versionData.mainClass;

  const isFabric = versionIdToLaunch.startsWith('fabric-loader-');
  const finalMainClass = isFabric ? 'net.fabricmc.loader.impl.launch.knot.KnotClient' : mainClass;

  const assetsIndex = versionData.assetIndex?.id || versionData.assets || options.version;

  const authUuid = (options.auth?.uuid || offlinePlayerUuid(options.nickname)).replace(/-/g, '');
  const accessToken = options.auth?.accessToken || '0';
  const assetsDir = path.join(options.gameDir, 'assets');
  const isVeryOldVersion = /^(?:a\d|b\d|rd-|inf-|c0\.|classic|indev|preclassic)/i.test(options.version);
  const gameArgs: string[] = typeof versionData.minecraftArguments === 'string'
    ? versionData.minecraftArguments.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token: string) => {
      const cleaned = (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")) ? token.slice(1, -1) : token;
      const variables: Record<string, string> = {
        auth_player_name: options.nickname,
        version_name: options.version,
        game_directory: options.runDir || options.gameDir,
        assets_root: assetsDir,
        // Pre-1.6 metadata uses ${game_assets}, which means assets/virtual/<asset-id>.
        game_assets: path.join(assetsDir, 'virtual', versionData.assets || versionData.assetIndex?.id || 'legacy'),
        assets_index_name: versionData.assetIndex?.id || versionData.assets || options.version,
        assets_index: versionData.assetIndex?.id || versionData.assets || options.version,
        auth_uuid: authUuid,
        auth_access_token: accessToken,
        auth_session: accessToken,
        auth_player_properties: '{}',
        user_properties: '{}',
        auth_xuid: '',
        clientid: '',
        user_type: options.auth ? 'msa' : 'legacy',
        version_type: 'release',
        resolution_width: String(options.width),
        resolution_height: String(options.height),
      };
      return cleaned.replace(/\$\{([^}]+)\}/g, (_match: string, key: string) => variables[key] ?? '');
    }).filter((arg: string) => arg.length > 0) || []
    : isVeryOldVersion
      ? [options.nickname, accessToken]
      : [
      '--username', options.nickname,
      '--version', options.version,
      '--gameDir', options.runDir || options.gameDir,
      '--assetsDir', assetsDir,
      '--assetIndex', assetsIndex,
      '--uuid', authUuid,
      '--accessToken', accessToken,
      '--userType', options.auth ? 'msa' : 'legacy',
      '--versionType', 'release',
      '--width', String(options.width),
      '--height', String(options.height),
    ];

  if (options.fullscreen && !isVeryOldVersion) gameArgs.push('--fullscreen');

  // Auto-join a server (used by "Play with a friend"). 1.20+ has quick play; older versions use --server/--port.
  if (options.server && /^[\w.\-]+(:\d{1,5})?$/.test(options.server) && !isVeryOldVersion) {
    const minor = /^1\.(\d+)/.exec(options.version);
    const snap = /^(\d{2})w/.exec(options.version);
    const modern = minor ? Number(minor[1]) >= 20 : snap ? Number(snap[1]) >= 23 : true;
    if (modern) gameArgs.push('--quickPlayMultiplayer', options.server);
    else { const [h, pt] = options.server.split(':'); gameArgs.push('--server', h, '--port', pt || '25565'); }
  }

  // Alpha/Beta manifests put positional username/session arguments before --tweakClass.
  // LaunchWrapper may then fail to consume --tweakClass correctly (especially if an earlier
  // placeholder was empty). Put the tweaker option first so AlphaVanillaTweaker is selected.
  if (mainClass === 'net.minecraft.launchwrapper.Launch') {
    const tweakIndex = gameArgs.findIndex((arg) => arg === '--tweakClass');
    if (tweakIndex >= 0 && gameArgs[tweakIndex + 1]) {
      const tweakClass = gameArgs[tweakIndex + 1];
      gameArgs.splice(tweakIndex, 2);
      gameArgs.unshift('--tweakClass', tweakClass);
    } else {
      gameArgs.unshift('--tweakClass', 'net.minecraft.launchwrapper.AlphaVanillaTweaker');
    }
  }

  const jvmArgs = [
    `-Xmx${options.ram}M`,
    `-Xms${Math.min(options.ram, 1024)}M`,
    ...(options.fpsBoost ? getAikarFlags(options.ram) : []),
    `-Djava.library.path=${nativesDir}`,
    `-Dorg.lwjgl.librarypath=${nativesDir}`,
    '-cp', classpath.join(sep),
  ];

  const allArgs = [...jvmArgs, finalMainClass, ...gameArgs];
  const missingRuntimeFiles = classpath.filter((entry) => !fileMatches(entry));
  if (missingRuntimeFiles.length) {
    throw new Error(`Не хватает ${missingRuntimeFiles.length} библиотек Minecraft. Повтори запуск — лаунчер проверит и докачает файлы.`);
  }
  if (!finalMainClass) throw new Error(`В данных версии ${versionIdToLaunch} отсутствует mainClass`);

  try {
    const { spawn } = require('node:child_process');
    const logDir = path.join(options.gameDir, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'launcher-debug.log');
    const logFile = fs.openSync(logPath, 'a');

    fs.writeSync(logFile, `\n\n===== ЗАПУСК ${new Date().toISOString()} =====\n`);
    fs.writeSync(logFile, `Loader: ${options.loader}\nVersion: ${versionIdToLaunch}\nMainClass: ${finalMainClass}\n`);
    fs.writeSync(logFile, `Java: ${java.path} (major ${java.majorVersion})\n`);
    fs.writeSync(logFile, `Native JARs: ${nativeJars.map((jar) => path.basename(jar)).join(', ') || '(none)'}\n`);
    let nativeFiles: string[] = [];
    try { nativeFiles = fs.readdirSync(nativesDir).filter((name) => /\.(?:dll|so|dylib)$/i.test(name)); } catch {}
    fs.writeSync(logFile, `Native files: ${nativeFiles.join(', ') || '(none)'}\n`);
    fs.writeSync(logFile, `Natives: ${nativesDir}\n`);
    fs.writeSync(logFile, `FPS Boost: ${options.fpsBoost ? 'ON' : 'OFF'}\n`);
    fs.writeSync(logFile, `Classpath entries: ${classpath.length}\n`);
    fs.writeSync(logFile, `Classpath files:\n${classpath.map((entry, index) => `  [${index + 1}] ${entry}`).join('\n')}\n`);
    fs.writeSync(logFile, `Client JAR: ${clientJar} (${fs.statSync(clientJar).size} bytes)\n\n`);

    onProgress?.('Запуск игры...', 100);

    const proc = spawn(java.path!, allArgs, {
      cwd: options.runDir || options.gameDir,
      detached: true,
      stdio: ['ignore', logFile, logFile],
    });

    let logClosed = false;
    const closeLog = () => {
      if (logClosed) return;
      logClosed = true;
      try { fs.closeSync(logFile); } catch {}
    };
    proc.on('error', (err: Error) => {
      try { fs.writeSync(logFile, `\n[ERROR] ${err.message}\n`); } catch {}
    });
    proc.on('exit', (code: number | null) => {
      try { fs.writeSync(logFile, `\n[EXIT] Код: ${code}\n`); } catch {}
      closeLog();
    });

    // A successful spawn event alone is not enough: Java can immediately exit when its
    // classpath or game data is incomplete. Wait briefly and report that as a failed launch.
    const startupResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      let settled = false;
      let spawned = false;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: { success: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        resolve(result);
      };
      proc.once('spawn', () => {
        spawned = true;
        startupTimer = setTimeout(() => finish({ success: true }), 1800);
      });
      proc.once('error', (err: Error) => finish({ success: false, error: `Не удалось запустить Java: ${err.message}` }));
      proc.once('exit', (code: number | null) => {
        if (!spawned || !settled) finish({ success: false, error: `Minecraft завершился сразу после запуска (код ${code ?? 'неизвестен'}). Проверь логи в .gromclient/logs/launcher-debug.log.` });
      });
    });

    if (!startupResult.success) {
      try { proc.kill(); } catch {}
      closeLog();
      return { success: false, error: startupResult.error };
    }
    proc.unref();
    return { success: true, process: proc };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}