import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'GromClient/1.0.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

export async function installFabric(
  mcVersion: string,
  gameDir: string,
  onProgress?: (msg: string, percent: number) => void
): Promise<{ success: boolean; versionId?: string; error?: string }> {
  try {
    onProgress?.('Получение списка Fabric-лоадеров...', 5);

    const loaders = await httpsGetJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!loaders || loaders.length === 0) {
      return { success: false, error: `Fabric не поддерживает версию ${mcVersion}` };
    }

    const latestLoader = loaders[0].loader.version;
    onProgress?.(`Fabric ${latestLoader} найден`, 20);

    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${latestLoader}/profile/json`;
    const profile = await httpsGetJson(profileUrl);

    const versionId = `fabric-loader-${latestLoader}-${mcVersion}`;
    const versionDir = path.join(gameDir, 'versions', versionId);
    fs.mkdirSync(versionDir, { recursive: true });

    const vanillaJsonPath = path.join(gameDir, 'versions', mcVersion, `${mcVersion}.json`);
    if (!fs.existsSync(vanillaJsonPath)) {
      return { success: false, error: `Сначала установи ванильную версию ${mcVersion}` };
    }

    const vanillaJson = JSON.parse(fs.readFileSync(vanillaJsonPath, 'utf-8'));
    const merged = {
      ...vanillaJson,
      ...profile,
      id: versionId,
      inheritsFrom: mcVersion,
      libraries: [...(vanillaJson.libraries || []), ...(profile.libraries || [])],
    };

    fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(merged, null, 2));

    onProgress?.('Fabric установлен!', 100);
    return { success: true, versionId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function installLoader(
  loader: string,
  mcVersion: string,
  gameDir: string,
  onProgress?: (msg: string, percent: number) => void
): Promise<{ success: boolean; versionId?: string; error?: string }> {
  if (loader === 'Fabric') return installFabric(mcVersion, gameDir, onProgress);
  if (loader === 'Vanilla') return { success: true, versionId: mcVersion };
  return { success: false, error: `Загрузчик ${loader} не поддерживается` };
}