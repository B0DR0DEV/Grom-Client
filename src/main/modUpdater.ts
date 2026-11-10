import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODRINTH_API = 'https://api.modrinth.com/v2';

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'GromClient/0.2.0' } }, (res) => {
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

function sha1File(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

export async function checkModUpdates(modsDir: string, gameVersion: string, loader: string): Promise<any[]> {
  if (!fs.existsSync(modsDir)) return [];

  const files = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'));
  if (files.length === 0) return [];

  // Считаем SHA-1 каждого файла
  const hashes: Record<string, string> = {};
  for (const file of files) {
    try {
      hashes[sha1File(path.join(modsDir, file))] = file;
    } catch {}
  }

  const hashList = Object.keys(hashes);
  if (hashList.length === 0) return [];

  try {
    // Modrinth API: получить информацию о версиях по хешам
    const url = `${MODRINTH_API}/version_files`;
    const body = JSON.stringify({ hashes: hashList, algorithm: 'sha1' });

    const result = await new Promise<any>((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'GromClient/0.2.0',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const updates: any[] = [];

    for (const [hash, versionInfo] of Object.entries(result) as any) {
      const fileName = hashes[hash];
      if (!fileName) continue;

      // Проверяем, есть ли более новая версия
      try {
        const projectId = versionInfo.project_id;
        const versionsUrl = `${MODRINTH_API}/project/${projectId}/version?game_versions=["${gameVersion}"]&loaders=["${loader}"]`;
        const versions = await httpsGetJson(versionsUrl);

        if (versions.length > 0) {
          const latest = versions[0];
          if (latest.id !== versionInfo.id) {
            updates.push({
              fileName,
              projectId,
              projectName: versionInfo.name || 'Unknown',
              currentVersion: versionInfo.version_number,
              latestVersion: latest.version_number,
              downloadUrl: latest.files[0]?.url,
              newFileName: latest.files[0]?.filename,
            });
          }
        }
      } catch {}
    }

    return updates;
  } catch (err: any) {
    console.error('Ошибка проверки обновлений:', err.message);
    return [];
  }
}

export async function updateMod(
  modsDir: string,
  oldFileName: string,
  downloadUrl: string,
  newFileName: string
): Promise<void> {
  const oldPath = path.join(modsDir, oldFileName);
  const newPath = path.join(modsDir, newFileName);

  // Удаляем старый
  if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

  // Скачиваем новый
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(newPath);
    https.get(downloadUrl, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', reject);
  });
}