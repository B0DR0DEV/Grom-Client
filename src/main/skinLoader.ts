import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Offline Minecraft does not load skins by itself, so every player sees Steve/Alex.
 * For modded launches we add CustomSkinLoader (official binary from Modrinth, GPL-3.0) and point it at:
 *   1. Grom cloud skins (what players set in our launcher),
 *   2. its built-in sources (Mojang, Ely.by, LittleSkin…),
 *   3. TLauncher skins (fixed URL, the mod's built-in TLauncher entry is broken).
 * Our copy is named grom-skinloader-*.jar and swapped on every launch so a shared mods folder never
 * keeps a jar for the wrong game version.
 */
const GROM_DIR = path.join(os.homedir(), '.gromclient');
const CACHE = path.join(GROM_DIR, 'cache', 'skinloader');
const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'GromClient/1.5.0 (skin loader)' };
const PREFIX = 'grom-skinloader-';
export const GROM_SKIN_URL = 'https://hfvsqgerfuiovtcfdmbt.supabase.co/functions/v1/skin/{USERNAME}.png';

const MOD_LOADERS: Record<string, string[]> = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge'] };

function getJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: UA }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { if ((res.statusCode || 500) >= 400) return reject(new Error(`Modrinth ${res.statusCode}`)); try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('Modrinth: таймаут')));
  });
}

function download(url: string, dest: string, hops = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: UA }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location && hops > 0) { res.resume(); download(res.headers.location, dest, hops - 1).then(resolve, reject); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const tmp = `${dest}.part`; const out = fs.createWriteStream(tmp);
      res.pipe(out); out.on('error', reject);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
    });
    req.on('error', reject); req.setTimeout(30000, () => req.destroy(new Error('Таймаут загрузки')));
  });
}

async function latestFile(project: string, loaders: string[], mc: string) {
  const q = `loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const versions: any[] = await getJson(`${API}/project/${project}/version?${q}`);
  const v = versions.find((x) => x.version_type === 'release') || versions[0];
  if (!v) return null;
  const file = v.files.find((f: any) => f.primary) || v.files[0];
  return { url: file.url as string, deps: (v.dependencies || []).filter((d: any) => d.dependency_type === 'required' && d.project_id) as { project_id: string }[] };
}

async function cached(name: string, fetcher: () => Promise<{ url: string } | null>) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  const meta = await fetcher(); if (!meta) return null;
  fs.mkdirSync(CACHE, { recursive: true });
  await download(meta.url, file);
  return file;
}

function writeSources(runDir: string) {
  const dir = path.join(runDir, 'CustomSkinLoader', 'ExtraList');
  fs.mkdirSync(dir, { recursive: true });
  const put = (name: string, entry: object) => fs.writeFileSync(path.join(dir, name), JSON.stringify(entry, null, 2));
  put('GromClient.json', { name: 'GromClient', type: 'Legacy', checkPNG: false, skin: GROM_SKIN_URL, model: 'auto' });
  put('TLauncherFix.json', { name: 'TLauncherFix', type: 'Legacy', checkPNG: false, skin: 'http://auth.tlauncher.org/skin/fileservice/skins/skin_{USERNAME}.png', model: 'auto' });
}

/** Returns a short status line for the launch log. Never throws: skins must not block the game. */
export async function prepareSkinLoader(runDir: string, mcVersion: string, loader: string): Promise<string> {
  const key = String(loader || '').toLowerCase().replace(/[^a-z]/g, '');
  const modsDir = path.join(runDir, 'mods');
  try {
    if (fs.existsSync(modsDir)) {
      for (const f of fs.readdirSync(modsDir)) {
        const keep = f === `${PREFIX}${key}-${mcVersion}.jar` || f.startsWith(`${PREFIX}${key}-${mcVersion}-dep-`);
        if (f.startsWith(PREFIX) && !keep) fs.rmSync(path.join(modsDir, f), { force: true });
      }
    }
    const loaders = MOD_LOADERS[key];
    if (!loaders) return 'Скины других игроков видны только с Fabric/Forge/NeoForge/Quilt';
    fs.mkdirSync(modsDir, { recursive: true });
    writeSources(runDir);
    const own = fs.readdirSync(modsDir).filter((f) => /customskinloader/i.test(f) && !f.startsWith(PREFIX) && f.endsWith('.jar'));
    if (own.length) return 'CustomSkinLoader уже установлен — добавлены источники скинов Grom';

    const depsFile = path.join(CACHE, `csl-${key}-${mcVersion}.deps.json`);
    const jar = await cached(`csl-${key}-${mcVersion}.jar`, async () => {
      const meta = await latestFile('customskinloader', loaders, mcVersion);
      if (meta) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(depsFile, JSON.stringify(meta.deps)); }
      return meta;
    });
    if (!jar) return `CustomSkinLoader пока не поддерживает ${loader} ${mcVersion}`;
    fs.copyFileSync(jar, path.join(modsDir, `${PREFIX}${key}-${mcVersion}.jar`));

    // Required dependencies (if the mod ever needs any): add only when the player doesn't have them already.
    let deps: { project_id: string }[] = [];
    try { deps = JSON.parse(fs.readFileSync(depsFile, 'utf8')); } catch {}
    for (const d of deps) {
      const project = await getJson(`${API}/project/${d.project_id}`).catch(() => null);
      const slug = String(project?.slug || d.project_id);
      const present = fs.readdirSync(modsDir).some((f) => f.toLowerCase().includes(slug.toLowerCase().replace(/-/g, '')) || f.toLowerCase().includes(slug.toLowerCase()));
      if (present) continue;
      const depJar = await cached(`dep-${slug}-${key}-${mcVersion}.jar`, () => latestFile(d.project_id, loaders, mcVersion));
      if (depJar) fs.copyFileSync(depJar, path.join(modsDir, `${PREFIX}${key}-${mcVersion}-dep-${slug}.jar`));
    }
    return 'Скины игроков подключены (Grom, Ely.by, TLauncher, Mojang)';
  } catch (err: any) {
    return `Скины игроков не подключены: ${err?.message || err}`;
  }
}
