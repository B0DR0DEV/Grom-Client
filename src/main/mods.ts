import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const MODRINTH_API = 'https://api.modrinth.com/v2';

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'GromClient/1.0.0 (contact@gromclient.local)' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Modrinth API: ${res.statusCode} — ${parsed.error || parsed.description || 'ошибка'}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Не удалось распарсить ответ: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут Modrinth')); });
  });
}

function mapHit(hit: any) {
  return {
    id: hit.project_id,
    slug: hit.slug,
    name: hit.title,
    description: hit.description,
    icon: hit.icon_url,
    downloads: hit.downloads,
    projectType: hit.project_type,
  };
}

/**
 * Универсальный поиск по Modrinth.
 * projectType: 'mod' | 'resourcepack' | 'shader' | 'modpack' | 'datapack'
 */
export async function searchMods(
  query: string,
  gameVersion?: string,
  loader?: string,
  projectType: string = 'mod'
): Promise<any[]> {
  const params = new URLSearchParams();
  params.append('query', query);
  params.append('limit', '20');
  params.append('index', 'relevance');

  const facets: string[][] = [[`project_type:${projectType}`]];
  if (gameVersion && gameVersion.trim()) facets.push([`versions:${gameVersion.trim()}`]);

  // Для ресурспаков и шейдеров загрузчик не важен
  if (projectType === 'mod' || projectType === 'modpack') {
    const loaderLower = loader?.trim().toLowerCase() || '';
    if (loaderLower && loaderLower !== 'vanilla') facets.push([`categories:${loaderLower}`]);
  }

  params.append('facets', JSON.stringify(facets));

  const url = `${MODRINTH_API}/search?${params.toString()}`;
  const data = await httpsGetJson(url);

  if (!data.hits) return [];
  return data.hits.map(mapHit);
}

/**
 * Популярные проекты (по downloads).
 * Для модов — с учётом версии MC и загрузчика.
 * Для ресурспаков/шейдеров — по downloads, версия опциональна.
 */
export async function getPopularMods(
  gameVersion?: string,
  loader?: string,
  projectType: string = 'mod'
): Promise<any[]> {
  const params = new URLSearchParams();
  params.append('limit', '20');
  params.append('index', 'downloads');

  const facets: string[][] = [[`project_type:${projectType}`]];
  if (gameVersion && gameVersion.trim()) facets.push([`versions:${gameVersion.trim()}`]);

  if (projectType === 'mod' || projectType === 'modpack') {
    const loaderLower = loader?.trim().toLowerCase() || '';
    if (loaderLower && loaderLower !== 'vanilla') facets.push([`categories:${loaderLower}`]);
  }

  params.append('facets', JSON.stringify(facets));

  const url = `${MODRINTH_API}/search?${params.toString()}`;
  const data = await httpsGetJson(url);

  if (!data.hits) return [];
  return data.hits.map(mapHit);
}

export async function getModCompatibleVersions(
  projectId: string
): Promise<{ gameVersions: string[]; loaders: string[] }> {
  const url = `${MODRINTH_API}/project/${projectId}/version`;
  const versions = await httpsGetJson(url);

  if (!Array.isArray(versions)) {
    return { gameVersions: [], loaders: [] };
  }

  const gameVersionsSet = new Set<string>();
  const loadersSet = new Set<string>();

  for (const v of versions) {
    for (const gv of v.game_versions || []) gameVersionsSet.add(gv);
    for (const l of v.loaders || []) loadersSet.add(l);
  }

  const gameVersions = Array.from(gameVersionsSet).sort((a, b) => {
    const aParts = a.split('.').map((x) => parseInt(x) || 0);
    const bParts = b.split('.').map((x) => parseInt(x) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (bParts[i] || 0) - (aParts[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const loaders = Array.from(loadersSet).sort();

  return { gameVersions, loaders };
}

/**
 * Универсальная загрузка проекта (мод/ресурспак/шейдер).
 * Просто сохраняет основной файл в targetDir.
 */
export async function downloadProjectContent(
  projectId: string,
  gameVersion: string,
  loader: string,
  targetDir: string,
  projectType: string = 'mod'
): Promise<string> {
  const params = new URLSearchParams();
  params.append('game_versions', JSON.stringify([gameVersion]));

  // Для ресурспаков и шейдеров загрузчик не нужен
  if (projectType === 'mod' || projectType === 'modpack') {
    const loaderLower = loader?.trim().toLowerCase() || '';
    if (loaderLower && loaderLower !== 'vanilla') {
      params.append('loaders', JSON.stringify([loaderLower]));
    }
  }

  const url = `${MODRINTH_API}/project/${projectId}/version?${params.toString()}`;
  const versions = await httpsGetJson(url);

  if (!versions || versions.length === 0) {
    throw new Error(`Нет версии для Minecraft ${gameVersion}${projectType === 'mod' ? ` и загрузчика ${loader || 'Vanilla'}` : ''}`);
  }

  const latest = versions[0];
  const file = latest.files.find((f: any) => f.primary) || latest.files[0];
  if (!file) throw new Error('Файл не найден');

  fs.mkdirSync(targetDir, { recursive: true });
  const destPath = path.join(targetDir, file.filename);

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(destPath);
    const req = https.get(file.url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          res2.pipe(writeStream);
          writeStream.on('finish', () => { writeStream.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(writeStream);
        writeStream.on('finish', () => { writeStream.close(); resolve(); });
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут скачивания')); });
  });

  return file.filename;
}

// ─────── СТАРЫЕ ФУНКЦИИ (для совместимости) ───────

export async function downloadMod(
  projectId: string,
  gameVersion: string,
  loader: string,
  modsDir: string
): Promise<string> {
  return downloadProjectContent(projectId, gameVersion, loader, modsDir, 'mod');
}

export async function searchModpacks(query: string, gameVersion?: string): Promise<any[]> {
  const params = new URLSearchParams();
  params.append('query', query);
  params.append('limit', '20');
  params.append('index', 'relevance');

  const facets: string[][] = [['project_type:modpack']];
  if (gameVersion && gameVersion.trim()) facets.push([`versions:${gameVersion.trim()}`]);

  params.append('facets', JSON.stringify(facets));

  const url = `${MODRINTH_API}/search?${params.toString()}`;
  const data = await httpsGetJson(url);

  return (data.hits || []).map(mapHit);
}

export async function downloadModpack(projectId: string, gameVersion: string, targetDir: string): Promise<string> {
  const url = `${MODRINTH_API}/project/${projectId}/version?game_versions=["${gameVersion}"]`;
  const versions = await httpsGetJson(url);
  if (!versions || versions.length === 0) throw new Error('Нет версии для этой игры');

  const latest = versions[0];
  const file = latest.files.find((f: any) => f.primary) || latest.files[0];
  if (!file) throw new Error('Файл .mrpack не найден');

  fs.mkdirSync(targetDir, { recursive: true });
  const destPath = path.join(targetDir, file.filename);

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(destPath);
    https.get(file.url, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          res2.pipe(writeStream);
          writeStream.on('finish', () => { writeStream.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(writeStream);
        writeStream.on('finish', () => { writeStream.close(); resolve(); });
      }
    }).on('error', reject);
  });

  return file.filename;
}