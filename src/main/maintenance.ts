import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';

export type LaunchRecord = { version: string; loader: string; startedAt: string; endedAt?: string; durationMs?: number; exitCode?: number; instance?: string; server?: string; peakRamMb?: number; loadMs?: number };
const dataDir = path.join(os.homedir(), '.gromclient');
const statsFile = path.join(dataDir, 'game-stats.json');
function readStats(): LaunchRecord[] {
  try { const x = JSON.parse(fs.readFileSync(statsFile, 'utf8')); return Array.isArray(x) ? x : []; } catch { return []; }
}
function writeStats(rows: LaunchRecord[]) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(statsFile, JSON.stringify(rows.slice(-5000), null, 2)); }
export function addLaunch(version: string, loader: string, instance?: string, server?: string) {
  const rows = readStats(); rows.push({ version, loader, startedAt: new Date().toISOString(), instance: instance || undefined, server: server || undefined }); writeStats(rows); return rows.length - 1;
}
export function finishLaunch(index: number, exitCode?: number) {
  const rows = readStats(); const row = rows[index]; if (!row) return;
  row.endedAt = new Date().toISOString(); row.exitCode = exitCode;
  row.durationMs = Math.max(0, Date.parse(row.endedAt) - Date.parse(row.startedAt)); writeStats(rows);
}
function patchLaunch(index: number, patch: Partial<LaunchRecord>) {
  const rows = readStats(); const row = rows[index]; if (!row) return;
  Object.assign(row, patch); writeStats(rows);
}
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function getGameStats() {
  const rows = readStats();
  const byDay: Record<string, number> = {}; const byVersion: Record<string, number> = {}; const byInstance: Record<string, number> = {}; const byServer: Record<string, number> = {};
  const hours = new Array(24).fill(0) as number[];
  const ram: number[] = []; const loads: number[] = [];
  for (const r of rows) {
    const ms = r.durationMs || 0; if (!ms) continue;
    const start = new Date(r.startedAt);
    byDay[dayKey(start)] = (byDay[dayKey(start)] || 0) + ms;
    byVersion[`${r.version} ${r.loader}`] = (byVersion[`${r.version} ${r.loader}`] || 0) + ms;
    if (r.instance) byInstance[r.instance] = (byInstance[r.instance] || 0) + ms;
    if (r.server) byServer[r.server] = (byServer[r.server] || 0) + ms;
    hours[start.getHours()] += ms;
    if (r.peakRamMb) ram.push(r.peakRamMb); if (r.loadMs) loads.push(r.loadMs);
  }
  let streak = 0; const cur = new Date();
  if (!byDay[dayKey(cur)]) cur.setDate(cur.getDate() - 1);
  while (byDay[dayKey(cur)]) { streak++; cur.setDate(cur.getDate() - 1); }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  return {
    launches: rows.length, totalDurationMs: rows.reduce((n, r) => n + (r.durationMs || 0), 0), recent: rows.slice(-10).reverse(),
    sessions: rows.slice(-40).reverse(), byDay, byVersion, byInstance, byServer, hours, streak,
    longestMs: rows.reduce((m, r) => Math.max(m, r.durationMs || 0), 0), avgPeakRamMb: avg(ram), avgLoadMs: avg(loads),
    crashes: rows.filter((r) => r.exitCode && r.exitCode !== 0).length,
  };
}
function sampleRssMb(pid: number): Promise<number> {
  return new Promise((resolve) => {
    const done = (txt: string, kb: boolean) => { const n = parseInt(String(txt).trim(), 10); resolve(Number.isFinite(n) ? Math.round(kb ? n / 1024 : n / 1048576) : 0); };
    if (process.platform === 'win32') execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`], { timeout: 8000, windowsHide: true }, (e, out) => done(e ? '' : out, false));
    else execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 4000 }, (e, out) => done(e ? '' : out, true));
  });
}
/** Samples RAM and detects when the game finished loading. Returns a stop function. */
export function monitorSession(index: number, pid: number | undefined, gameDir: string): () => void {
  if (!pid) return () => {};
  const startedAt = Date.now(); let peak = 0; let loaded = false; let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const mb = await sampleRssMb(pid);
    if (mb > peak) { peak = mb; patchLaunch(index, { peakRamMb: peak }); }
    if (!loaded) {
      try {
        const log = fs.readFileSync(path.join(gameDir, 'logs', 'latest.log'), 'utf8').slice(-300_000);
        if (/Sound engine started|OpenAL initialized/i.test(log) && fs.statSync(path.join(gameDir, 'logs', 'latest.log')).mtimeMs >= startedAt - 5000) { loaded = true; patchLaunch(index, { loadMs: Date.now() - startedAt }); }
      } catch {}
    }
  };
  const timer = setInterval(tick, 15000); setTimeout(tick, 4000);
  return () => { stopped = true; clearInterval(timer); };
}
export function diagnoseGame(gameDir: string) {
  const logsDir = path.join(gameDir, 'logs'); const crashDir = path.join(gameDir, 'crash-reports');
  const candidates: string[] = [];
  try { candidates.push(...fs.readdirSync(crashDir).filter(x => x.endsWith('.txt')).map(x => path.join(crashDir, x))); } catch {}
  try { const latest = path.join(logsDir, 'latest.log'); if (fs.existsSync(latest)) candidates.push(latest); } catch {}
  const latestPath = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!latestPath) return { found: false, file: null, modifiedAt: null, summary: 'Логи не найдены. Запусти Minecraft хотя бы один раз.', findings: [] as string[] };
  const content = fs.readFileSync(latestPath, 'utf8').slice(-1_500_000);
  const findings: string[] = [];
  if (/OutOfMemoryError|Could not reserve enough space/i.test(content)) findings.push('Возможная нехватка памяти Java. Проверь выделенную RAM и свободную память Windows.');
  if (/Mixin apply failed|MixinApplyError|InvalidMixinException/i.test(content)) findings.push('Похоже на конфликт или несовместимость мода. Проверь последние установленные моды.');
  if (/UnsupportedClassVersionError|class file version/i.test(content)) findings.push('Возможна несовместимость версии Java с Minecraft или модом.');
  if (/ModResolutionException|Incompatible mod set|requires .* but/i.test(content)) findings.push('Похоже, не хватает зависимости или версии мода не совпадают.');
  if (/OpenGL error|GL_OUT_OF_MEMORY|Failed to create.*context/i.test(content)) findings.push('Обнаружена возможная графическая ошибка. Проверь драйвер видеокарты и шейдеры.');
  if (!findings.length) findings.push('Автоматический анализ не нашёл типичную причину. Открой файл лога и проверь строки ERROR/FATAL перед завершением.');
  return { found: true, file: path.basename(latestPath), modifiedAt: fs.statSync(latestPath).mtime.toISOString(), summary: findings[0], findings };
}
export function scanMods(modsDir: string) {
  fs.mkdirSync(modsDir, { recursive: true });
  return fs.readdirSync(modsDir).filter(n => n.toLowerCase().endsWith('.jar')).map(name => {
    const full = path.join(modsDir, name); const stat = fs.statSync(full); const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    const warnings: string[] = [];
    if (stat.size === 0) warnings.push('Файл пустой');
    if (stat.size > 300 * 1024 * 1024) warnings.push('Необычно большой JAR');
    if (/(crack|cheat|injector|stealer|rat|trojan|hack)/i.test(name)) warnings.push('Имя содержит подозрительные слова — проверь источник вручную');
    return { name, size: stat.size, sha256: hash, warnings, modifiedAt: stat.mtime.toISOString(), verdict: warnings.length ? 'warning' : 'unknown' };
  });
}
export function checkMinecraftFiles(gameDir: string) {
  const checks = [
    { name: 'versions', path: path.join(gameDir, 'versions') },
    { name: 'libraries', path: path.join(gameDir, 'libraries') },
    { name: 'assets', path: path.join(gameDir, 'assets') },
  ];
  const results = checks.map(x => ({ name: x.name, exists: fs.existsSync(x.path), isDirectory: fs.existsSync(x.path) && fs.statSync(x.path).isDirectory() }));
  const missing = results.filter(x => !x.exists).map(x => x.name);
  return { ok: missing.length === 0, results, message: missing.length ? `Не найдены папки: ${missing.join(', ')}. Они могут появиться после установки/запуска соответствующей версии.` : 'Основные папки Minecraft найдены. Это базовая проверка структуры, не полная проверка каждого файла.' };
}
