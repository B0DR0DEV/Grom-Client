import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// В dev: assets в корне проекта, в prod: в resources/assets
const isDev = !app.isPackaged;
const PETS_DIR = isDev
  ? path.join(__dirname, '../../assets/pets')
  : path.join(process.resourcesPath, 'assets/pets');

export function listPetFrames(petName: string): string[] {
  const petDir = path.join(PETS_DIR, petName);
  if (!fs.existsSync(petDir)) return [];

  const files = fs.readdirSync(petDir)
    .filter((f) => f.endsWith('.png'))
    .sort();

  return files.map((f) => {
    const buffer = fs.readFileSync(path.join(petDir, f));
    return `data:image/png;base64,${buffer.toString('base64')}`;
  });
}