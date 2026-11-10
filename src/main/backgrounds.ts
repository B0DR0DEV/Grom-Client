import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const BACKGROUNDS_DIR = path.join(GROM_DIR, 'custom-backgrounds');

export function ensureCustomBgDir() {
  if (!fs.existsSync(BACKGROUNDS_DIR)) fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
}

export function listCustomBackgrounds(): { name: string; type: 'image' | 'video'; dataUrl: string }[] {
  ensureCustomBgDir();
  const files = fs.readdirSync(BACKGROUNDS_DIR);

  return files
    .filter((f) => /\.(png|jpg|jpeg|gif|mp4|webm)$/i.test(f))
    .map((f) => {
      const filePath = path.join(BACKGROUNDS_DIR, f);
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(f).slice(1).toLowerCase();
      const isVideo = ['mp4', 'webm'].includes(ext);
      const mime = ext === 'jpg' ? 'jpeg' : ext;

      return {
        name: f,
        type: isVideo ? 'video' : 'image',
        dataUrl: `data:${isVideo ? 'video' : 'image'}/${mime};base64,${buffer.toString('base64')}`,
      };
    });
}

export function saveCustomBackground(sourcePath: string): string {
  ensureCustomBgDir();
  const fileName = path.basename(sourcePath);
  const destPath = path.join(BACKGROUNDS_DIR, fileName);
  fs.copyFileSync(sourcePath, destPath);
  return destPath;
}

export function getCustomBackgroundPath(fileName: string): string {
  return path.join(BACKGROUNDS_DIR, fileName);
}