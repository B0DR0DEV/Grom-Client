import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createInstance, getInstanceModsDir, getInstancePath, listInstances } from './instances';

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'GromClient/1.5.0' };
const PREFIX = 'GROM1.';

export interface SharePayload { n: string; mc: string; l: string; v: string[]; u: number }

function requestJson(method: 'GET' | 'POST', url: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(url, {
      method,
      headers: { ...UA, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) return reject(new Error(`Modrinth ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Modrinth: таймаут')));
    if (payload) req.write(payload);
    req.end();
  });
}

function download(url: string, dest: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: UA }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location && redirects > 0) {
        res.resume();
        return download(res.headers.location, dest, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

export function encodeShare(p: SharePayload): string {
  return PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(p), 'utf8')).toString('base64url');
}

export function decodeShare(code: string): SharePayload {
  const clean = code.trim().replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) throw new Error('Это не код сборки Grom (должен начинаться с GROM1.)');
  let p: any;
  try { p = JSON.parse(zlib.inflateRawSync(Buffer.from(clean.slice(PREFIX.length), 'base64url')).toString('utf8')); }
  catch { throw new Error('Код повреждён или обрезан — скопируй его целиком'); }
  if (!p || typeof p.mc !== 'string' || !Array.isArray(p.v)) throw new Error('Неподдерживаемый формат кода');
  return { n: String(p.n || 'Сборка'), mc: p.mc, l: String(p.l || 'Vanilla'), v: p.v.map(String), u: Number(p.u) || 0 };
}

export async function exportShareCode(instanceName: string) {
  const dir = getInstancePath(instanceName);
  if (!fs.existsSync(dir)) throw new Error(`Сборка «${instanceName}» не найдена`);
  let meta: any = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')); } catch {}
  const modsDir = getInstanceModsDir(instanceName);
  const jars = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter((f) => f.toLowerCase().endsWith('.jar')) : [];
  const hashes = jars.map((f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(modsDir, f))).digest('hex'));
  const ids = new Set<string>();
  if (hashes.length) {
    const found = await requestJson('POST', `${API}/version_files`, { hashes, algorithm: 'sha1' });
    for (const h of hashes) if (found?.[h]?.id) ids.add(found[h].id);
  }
  const payload: SharePayload = { n: instanceName, mc: meta.version || 'Unknown', l: meta.loader || 'Vanilla', v: [...ids], u: jars.length - ids.size };
  return { code: encodeShare(payload), mods: ids.size, unresolved: payload.u, name: payload.n, version: payload.mc, loader: payload.l };
}

export function previewShareCode(code: string) {
  const p = decodeShare(code);
  return { name: p.n, version: p.mc, loader: p.l, mods: p.v.length, unresolved: p.u };
}

export async function importShareCode(code: string, wantedName: string | undefined, onProgress: (msg: string, pct: number) => void) {
  const p = decodeShare(code);
  const base = (wantedName || p.n).replace(/[\\/:*?"<>|]/g, '_').trim() || 'Сборка';
  const taken = new Set(listInstances().map((i) => i.name.toLowerCase()));
  let name = base; let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} (${n++})`;
  createInstance(name, p.mc, p.l);
  const modsDir = getInstanceModsDir(name);
  const failed: string[] = [];
  let installed = 0;
  if (p.v.length) {
    onProgress('Получаю список модов…', 3);
    const versions: any[] = await requestJson('GET', `${API}/versions?ids=${encodeURIComponent(JSON.stringify(p.v))}`);
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      const file = (v.files || []).find((f: any) => f.primary) || v.files?.[0];
      onProgress(`Скачиваю ${file?.filename || v.name}`, Math.round(5 + (i / versions.length) * 95));
      try {
        if (!file) throw new Error('нет файла');
        await download(file.url, path.join(modsDir, path.basename(file.filename)));
        installed++;
      } catch { failed.push(file?.filename || v.name || v.id); }
    }
    failed.push(...p.v.filter((id) => !versions.some((v) => v.id === id)).map((id) => `версия ${id}`));
  }
  onProgress('Готово', 100);
  return { name, version: p.mc, loader: p.l, installed, failed, unresolved: p.u };
}
