import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface MrpackManifest {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  files: { path: string; hashes: { sha1: string }; downloads: string[]; fileSize: number }[];
  dependencies: { minecraft: string; 'fabric-loader'?: string; 'forge'?: string };
}

// ЭКСПОРТ: сборка → .mrpack
export async function exportInstanceToMrpack(instancePath: string, outputPath: string): Promise<void> {
  const modsDir = path.join(instancePath, 'mods');
  const metaPath = path.join(instancePath, 'instance.json');

  if (!fs.existsSync(instancePath)) throw new Error('Сборка не найдена');

  let meta: any = { version: '1.21.4', loader: 'Vanilla' };
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  const manifest: MrpackManifest = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: path.basename(instancePath),
    files: [],
    dependencies: {
      minecraft: meta.version || '1.21.4',
    },
  };

  // Добавляем загрузчик
  if (meta.loader === 'Fabric') {
    manifest.dependencies['fabric-loader'] = '0.15.0';
  } else if (meta.loader === 'Forge') {
    manifest.dependencies['forge'] = '47.0.0';
  }

  // Создаём временную папку
  const tmpDir = path.join(instancePath, '.mrpack-tmp');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const overridesDir = path.join(tmpDir, 'overrides');
  fs.mkdirSync(overridesDir, { recursive: true });

  // Копируем config и saves (не моды — они идут в files)
  if (fs.existsSync(path.join(instancePath, 'config'))) {
    copyDir(path.join(instancePath, 'config'), path.join(overridesDir, 'config'));
  }
  if (fs.existsSync(path.join(instancePath, 'saves'))) {
    copyDir(path.join(instancePath, 'saves'), path.join(overridesDir, 'saves'));
  }

  // Сохраняем manifest
  fs.writeFileSync(path.join(tmpDir, 'modrinth.index.json'), JSON.stringify(manifest, null, 2));

  // Создаём .zip → переименовываем в .mrpack
  const zipPath = outputPath.replace('.mrpack', '.zip');
  execSync(`powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${zipPath}' -Force"`);

  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  fs.renameSync(zipPath, outputPath);

  fs.rmSync(tmpDir, { recursive: true });
}

// ИМПОРТ: .mrpack → сборка
export async function importMrpackToInstance(mrpackPath: string, instancesDir: string): Promise<string> {
  if (!fs.existsSync(mrpackPath)) throw new Error('.mrpack файл не найден');

  // Распаковываем во временную папку
  const tmpDir = path.join(instancesDir, '.import-tmp');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const zipPath = mrpackPath.replace('.mrpack', '.zip');
  fs.copyFileSync(mrpackPath, zipPath);

  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`);
  fs.unlinkSync(zipPath);

  // Читаем манифест
  const manifestPath = path.join(tmpDir, 'modrinth.index.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Неверный .mrpack: нет modrinth.index.json');

  const manifest: MrpackManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Создаём папку сборки
  const instanceName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Imported';
  const instancePath = path.join(instancesDir, instanceName);

  if (fs.existsSync(instancePath)) {
    fs.rmSync(instancePath, { recursive: true });
  }
  fs.mkdirSync(instancePath, { recursive: true });
  fs.mkdirSync(path.join(instancePath, 'mods'), { recursive: true });

  // Сохраняем метаданные
  const loader = manifest.dependencies['fabric-loader'] ? 'Fabric' :
                 manifest.dependencies['forge'] ? 'Forge' : 'Vanilla';
  fs.writeFileSync(path.join(instancePath, 'instance.json'), JSON.stringify({
    version: manifest.dependencies.minecraft,
    loader,
    createdAt: new Date().toISOString(),
  }, null, 2));

  // Копируем overrides
  const overridesDir = path.join(tmpDir, 'overrides');
  if (fs.existsSync(overridesDir)) {
    copyDir(overridesDir, instancePath);
  }

  // Скачиваем моды (файлы из манифеста)
  const modsToDownload = manifest.files.filter((f) => f.path.startsWith('mods/'));
  const https = require('node:https');

  for (const file of modsToDownload) {
    const url = file.downloads[0];
    const dest = path.join(instancePath, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await downloadFile(url, dest);
  }

  fs.rmSync(tmpDir, { recursive: true });

  return instanceName;
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const https = require('node:https');
    const file = fs.createWriteStream(dest);
    https.get(url, (res: any) => {
      if (res.statusCode === 302 && res.headers.location) {
        https.get(res.headers.location, (res2: any) => {
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