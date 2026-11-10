import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Moves player data from another launcher's game folder (.minecraft, Prism, CurseForge, Modrinth App…) into Grom. */

const GROM_DIR = path.join(os.homedir(), '.gromclient');

export interface ImportItemDef { key: string; label: string; hint?: string; files?: string[]; dirs?: string[]; byDefault: boolean }
export const IMPORT_ITEMS: ImportItemDef[] = [
  { key: 'options', label: 'Настройки игры', hint: 'графика, управление, звук, язык, шрифт, FOV', files: ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'options.amecsapi.txt'], byDefault: true },
  { key: 'servers', label: 'Список серверов', files: ['servers.dat'], byDefault: true },
  { key: 'resourcepacks', label: 'Ресурспаки', hint: 'текстуры, шрифты, звуки', dirs: ['resourcepacks'], byDefault: true },
  { key: 'shaderpacks', label: 'Шейдеры', dirs: ['shaderpacks'], byDefault: true },
  { key: 'saves', label: 'Миры', dirs: ['saves'], byDefault: true },
  { key: 'skins', label: 'Локальные скины', hint: 'папка CustomSkinLoader/LocalSkin', dirs: [path.join('CustomSkinLoader', 'LocalSkin')], byDefault: true },
  { key: 'screenshots', label: 'Скриншоты', dirs: ['screenshots'], byDefault: false },
  { key: 'mods', label: 'Моды и их настройки', hint: 'только если версия и загрузчик совпадают', dirs: ['mods', 'config'], byDefault: false },
  { key: 'maps', label: 'Карты и метки', hint: 'Xaero, JourneyMap, схемы', dirs: ['XaeroWaypoints', 'XaeroWorldMap', 'journeymap', 'schematics'], byDefault: false },
];

const MARKERS = ['options.txt', 'saves', 'resourcepacks', 'servers.dat'];
const isGameDir = (dir: string) => { try { return MARKERS.some((m) => fs.existsSync(path.join(dir, m))); } catch { return false; } };
const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Папки, внутри которых данных игры точно нет, — не заходим, чтобы поиск был быстрым.
const SKIP = new Set(['saves', 'mods', 'config', 'assets', 'libraries', 'versions', 'resourcepacks', 'shaderpacks', 'screenshots', 'logs',
  'crash-reports', 'natives', 'runtime', 'jre', 'java', 'cache', 'node_modules', '.git', 'backups', 'XaeroWorldMap', 'journeymap']);

/** Ищет папки игры внутри выбранной (например, .tlauncher → .tlauncher/legacy/Minecraft/game). */
export function findGameDirs(root: string, maxDepth = 5): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (found.length >= 30) return;
    if (isGameDir(dir)) { found.push(dir); return; }
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink() && !SKIP.has(e.name)) visit(path.join(dir, e.name), depth + 1);
  };
  visit(root, 0);
  return found.filter((d) => !same(d, GROM_DIR));
}

/** Самая «живая» папка: больше признаков игры, потом свежее options.txt. */
function rankGameDirs(dirs: string[]): string[] {
  const score = (d: string) => MARKERS.filter((m) => fs.existsSync(path.join(d, m))).length;
  const mtime = (d: string) => { try { return fs.statSync(path.join(d, 'options.txt')).mtimeMs; } catch { return 0; } };
  return [...dirs].sort((a, b) => score(b) - score(a) || mtime(b) - mtime(a));
}

function subdirs(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; }
}

export function detectSources(): { label: string; path: string }[] {
  const home = os.homedir();
  const appdata = process.env.APPDATA || (process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.local', 'share'));
  const out: { label: string; path: string }[] = [];
  const add = (label: string, p: string) => { if (isGameDir(p) && !same(p, GROM_DIR) && !out.some((o) => same(o.path, p))) out.push({ label, path: p }); };

  add('.minecraft — Minecraft, TLauncher, Legacy Launcher', process.platform === 'win32' ? path.join(appdata, '.minecraft') : process.platform === 'darwin' ? path.join(appdata, 'minecraft') : path.join(home, '.minecraft'));
  for (const root of [path.join(appdata, 'PrismLauncher', 'instances'), path.join(appdata, 'MultiMC', 'instances'), path.join(appdata, 'ElyPrismLauncher', 'instances')]) {
    for (const inst of subdirs(root)) for (const sub of ['.minecraft', 'minecraft']) add(`Prism/MultiMC — ${path.basename(inst)}`, path.join(inst, sub));
  }
  for (const inst of subdirs(path.join(home, 'curseforge', 'minecraft', 'Instances'))) add(`CurseForge — ${path.basename(inst)}`, inst);
  for (const root of [path.join(appdata, 'ModrinthApp', 'profiles'), path.join(appdata, 'com.modrinth.theseus', 'profiles')]) {
    for (const inst of subdirs(root)) add(`Modrinth App — ${path.basename(inst)}`, inst);
  }
  for (const name of ['.tlauncher', '.legacylauncher', 'LegacyLauncher']) {
    const root = path.join(appdata, name);
    for (const d of rankGameDirs(findGameDirs(root))) add(`Legacy Launcher / TLauncher — ${path.relative(root, d) || name}`, d);
  }
  return out;
}

async function walk(p: string, files: { abs: string; rel: string; size: number }[], base: string) {
  let st: fs.Stats;
  try { st = await fsp.lstat(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) { files.push({ abs: p, rel: path.relative(base, p), size: st.size }); return; }
  if (!st.isDirectory()) return;
  let entries: string[] = [];
  try { entries = await fsp.readdir(p); } catch { return; }
  for (const e of entries) await walk(path.join(p, e), files, base);
}

async function collect(src: string, def: ImportItemDef) {
  const files: { abs: string; rel: string; size: number }[] = [];
  for (const f of def.files || []) await walk(path.join(src, f), files, src);
  for (const d of def.dirs || []) await walk(path.join(src, d), files, src);
  return files;
}

export async function scanSource(src: string) {
  if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error('Папка не найдена');
  if (same(src, GROM_DIR)) throw new Error('Это папка самого Grom Client');
  let candidates: string[] = [];
  if (!isGameDir(src)) {
    candidates = rankGameDirs(findGameDirs(src));
    if (!candidates.length) throw new Error('В этой папке и вложенных папках нет данных Minecraft (options.txt, saves, resourcepacks…). Выбери папку игры другого лаунчера');
    src = candidates[0];
  }
  const items: { key: string; label: string; hint: string; files: number; bytes: number; byDefault: boolean }[] = [];
  for (const def of IMPORT_ITEMS) {
    const files = await collect(src, def);
    if (!files.length) continue;
    items.push({ key: def.key, label: def.label, hint: def.hint || '', files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), byDefault: def.byDefault });
  }
  const worlds = subdirs(path.join(src, 'saves')).length;
  return { path: src, items, worlds, candidates: candidates.length > 1 ? candidates : [] };
}

export async function runImport(src: string, dest: string, keys: string[], onProgress: (p: { done: number; total: number; file: string }) => void) {
  if (same(src, dest)) throw new Error('Источник и папка Grom совпадают');
  const defs = IMPORT_ITEMS.filter((d) => keys.includes(d.key));
  const files = (await Promise.all(defs.map((d) => collect(src, d)))).flat();
  const total = files.reduce((n, f) => n + f.size, 0);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(dest, `_import_backup_${stamp}`);
  let done = 0, copied = 0, skipped = 0, backedUp = 0, failed = 0;
  let lastEmit = 0;
  for (const f of files) {
    const target = path.join(dest, f.rel);
    try {
      const existing = await fsp.stat(target).catch(() => null);
      if (existing && existing.size === f.size && Math.abs(existing.mtimeMs - (await fsp.stat(f.abs)).mtimeMs) < 2000) { skipped++; }
      else {
        if (existing) {
          const b = path.join(backupDir, f.rel);
          await fsp.mkdir(path.dirname(b), { recursive: true });
          await fsp.copyFile(target, b); backedUp++;
        }
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.copyFile(f.abs, target);
        const st = await fsp.stat(f.abs); await fsp.utimes(target, st.atime, st.mtime).catch(() => {});
        copied++;
      }
    } catch { failed++; }
    done += f.size;
    if (Date.now() - lastEmit > 120) { lastEmit = Date.now(); onProgress({ done, total, file: f.rel }); }
  }
  onProgress({ done: total, total, file: '' });
  return { copied, skipped, backedUp, failed, backupDir: backedUp ? backupDir : '' };
}
