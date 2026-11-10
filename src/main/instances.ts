import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const INSTANCES_DIR = path.join(GROM_DIR, 'instances');

export interface Instance {
  name: string;
  version: string;
  loader: string;
  modsCount: number;
  createdAt: string;
}

export function ensureInstancesDir() {
  if (!fs.existsSync(INSTANCES_DIR)) fs.mkdirSync(INSTANCES_DIR, { recursive: true });
}

function countJarsRecursive(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countJarsRecursive(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.jar') || entry.name.endsWith('.jar.disabled')) {
      count++;
    }
  }
  return count;
}

export function listInstances(): Instance[] {
  ensureInstancesDir();
  const dirs = fs.readdirSync(INSTANCES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  return dirs.map((dir) => {
    const instancePath = path.join(INSTANCES_DIR, dir.name);
    const metaPath = path.join(instancePath, 'instance.json');
    const modsDir = path.join(instancePath, 'mods');

    let meta: any = { version: 'Unknown', loader: 'Vanilla' };
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
    }

    const modsCount = countJarsRecursive(modsDir);
    const stats = fs.statSync(instancePath);

    return {
      name: dir.name,
      version: meta.version || 'Unknown',
      loader: meta.loader || 'Vanilla',
      modsCount,
      createdAt: stats.birthtime.toISOString(),
    };
  });
}

export function createInstance(name: string, version: string, loader: string): Instance {
  ensureInstancesDir();
  const instancePath = path.join(INSTANCES_DIR, name);

  if (fs.existsSync(instancePath)) {
    throw new Error(`Сборка "${name}" уже существует`);
  }

  fs.mkdirSync(instancePath, { recursive: true });
  fs.mkdirSync(path.join(instancePath, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(instancePath, 'saves'), { recursive: true });
  fs.mkdirSync(path.join(instancePath, 'config'), { recursive: true });

  const meta = { version, loader, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(instancePath, 'instance.json'), JSON.stringify(meta, null, 2));

  return { name, version, loader, modsCount: 0, createdAt: meta.createdAt };
}

export function deleteInstance(name: string): void {
  const instancePath = path.join(INSTANCES_DIR, name);
  if (!fs.existsSync(instancePath)) throw new Error(`Сборка "${name}" не найдена`);
  fs.rmSync(instancePath, { recursive: true, force: true });
}

export function getInstancePath(name: string): string {
  return path.join(INSTANCES_DIR, name);
}

export function getInstanceModsDir(name: string): string {
  return path.join(INSTANCES_DIR, name, 'mods');
}