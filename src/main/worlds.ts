import fs from 'node:fs';
import path from 'node:path';

export interface WorldInfo {
  name: string;
  path: string;
  sizeBytes: number;
  lastPlayed: string | null;
  icon: string | null;
}

export interface ScreenshotInfo {
  name: string;
  dataUrl: string;
  date: string;
}

function getDirSize(dirPath: string): number {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else {
        try { total += fs.statSync(fullPath).size; } catch {}
      }
    }
  } catch {}
  return total;
}

export function listWorlds(gameDir: string, instanceName?: string): WorldInfo[] {
  const savesDir = instanceName
    ? path.join(gameDir, 'instances', instanceName, 'saves')
    : path.join(gameDir, 'saves');

  if (!fs.existsSync(savesDir)) return [];

  const dirs = fs.readdirSync(savesDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  return dirs.map((dir) => {
    const worldPath = path.join(savesDir, dir.name);
    const stats = fs.statSync(worldPath);

    let lastPlayed: string | null = null;
    const levelDat = path.join(worldPath, 'level.dat');
    if (fs.existsSync(levelDat)) {
      try {
        lastPlayed = fs.statSync(levelDat).mtime.toISOString();
      } catch {}
    }

    let icon: string | null = null;
    const iconPath = path.join(worldPath, 'icon.png');
    if (fs.existsSync(iconPath)) {
      try {
        const buffer = fs.readFileSync(iconPath);
        icon = `data:image/png;base64,${buffer.toString('base64')}`;
      } catch {}
    }

    return {
      name: dir.name,
      path: worldPath,
      sizeBytes: getDirSize(worldPath),
      lastPlayed: lastPlayed || stats.mtime.toISOString(),
      icon,
    };
  });
}

export function deleteWorld(gameDir: string, worldPath: string): void {
  if (!fs.existsSync(worldPath)) throw new Error('Мир не найден');
  fs.rmSync(worldPath, { recursive: true, force: true });
}

export function backupWorld(gameDir: string, worldPath: string, backupDir: string): string {
  const worldName = path.basename(worldPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${worldName}_${timestamp}`;
  const dest = path.join(backupDir, backupName);

  fs.mkdirSync(backupDir, { recursive: true });
  fs.cpSync(worldPath, dest, { recursive: true });

  return dest;
}

export function listScreenshots(gameDir: string, instanceName?: string): ScreenshotInfo[] {
  const screenshotsDir = instanceName
    ? path.join(gameDir, 'instances', instanceName, 'screenshots')
    : path.join(gameDir, 'screenshots');

  if (!fs.existsSync(screenshotsDir)) return [];

  const files = fs.readdirSync(screenshotsDir)
    .filter((f) => f.endsWith('.png') || f.endsWith('.jpg'))
    .sort()
    .reverse();

  return files.map((f) => {
    const filePath = path.join(screenshotsDir, f);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(f).slice(1) === 'jpg' ? 'jpeg' : path.extname(f).slice(1);
    const stats = fs.statSync(filePath);

    return {
      name: f,
      dataUrl: `data:image/${ext};base64,${buffer.toString('base64')}`,
      date: stats.mtime.toISOString(),
    };
  });
}