import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { findJava } from './java';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const SERVER_DIR = path.join(GROM_DIR, 'server');

let serverProcess: ChildProcess | null = null;

export async function downloadServer(version: string, onProgress?: (msg: string) => void): Promise<void> {
  const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

  onProgress?.('Получение манифеста сервера...');

  const manifest = await new Promise<any>((resolve, reject) => {
    https.get(manifestUrl, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const versionMeta = manifest.versions.find((v: any) => v.id === version);
  if (!versionMeta) throw new Error(`Версия ${version} не найдена`);

  const versionData = await new Promise<any>((resolve, reject) => {
    https.get(versionMeta.url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  if (!versionData.downloads?.server) {
    throw new Error(`Для версии ${version} нет server.jar`);
  }

  fs.mkdirSync(SERVER_DIR, { recursive: true });
  const serverJar = path.join(SERVER_DIR, 'server.jar');

  if (fs.existsSync(serverJar)) {
    onProgress?.('server.jar уже скачан');
    return;
  }

  onProgress?.('Скачивание server.jar...');

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(serverJar);
    https.get(versionData.downloads.server.url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });

  onProgress?.('server.jar скачан');
}

export async function startServer(version: string, ram: number, onLog: (msg: string) => void): Promise<{ success: boolean; error?: string }> {
  if (serverProcess) {
    return { success: false, error: 'Сервер уже запущен' };
  }

  const java = findJava();
  if (!java.found || !java.path) {
    return { success: false, error: 'Java не найдена. Скачай через лаунчер.' };
  }

  await downloadServer(version, onLog);

  const serverJar = path.join(SERVER_DIR, 'server.jar');
  if (!fs.existsSync(serverJar)) {
    return { success: false, error: 'server.jar не найден' };
  }

  const eulaPath = path.join(SERVER_DIR, 'eula.txt');
  if (!fs.existsSync(eulaPath)) {
    fs.writeFileSync(eulaPath, 'eula=true\n');
  }

  onLog('Запуск сервера...');

  serverProcess = spawn(java.path, [
    `-Xmx${ram}M`,
    `-Xms${Math.min(ram, 1024)}M`,
    '-jar', 'server.jar',
    'nogui',
  ], {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (data) => onLog(data.toString().trim()));
  serverProcess.stderr?.on('data', (data) => onLog(data.toString().trim()));

  serverProcess.on('close', (code) => {
    onLog(`Сервер закрыт (код: ${code})`);
    serverProcess = null;
  });

  return { success: true };
}

export async function stopServer(): Promise<void> {
  if (!serverProcess) return;

  serverProcess.stdin?.write('save-all\n');
  await new Promise((r) => setTimeout(r, 3000));
  serverProcess.stdin?.write('stop\n');

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      serverProcess?.kill();
      resolve();
    }, 10000);

    serverProcess?.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export function getServerProcess(): ChildProcess | null {
  return serverProcess;
}