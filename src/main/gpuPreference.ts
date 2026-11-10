import { exec, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const RUNTIME_DIR = path.join(GROM_DIR, 'runtime');

const REG_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

export type GpuMode = 'auto' | 'high' | 'low';

// GpuPreference значение в реестре:
//   0 = Auto
//   1 = Power Saving (встроенная)
//   2 = High Performance (дискретная)
function modeToPrefValue(mode: GpuMode): string {
  if (mode === 'high') return 'GpuPreference=2;';
  if (mode === 'low') return 'GpuPreference=1;';
  return 'GpuPreference=0;';
}

// Установить GPU-режим для конкретного .exe
export function setGpuPreferenceForExe(exePath: string, mode: GpuMode): Promise<boolean> {
  return new Promise((resolve) => {
    if (!exePath) return resolve(false);
    if (process.platform !== 'win32') return resolve(false);

    const isPath = exePath.includes('\\') || exePath.includes('/');
    if (isPath && !fs.existsSync(exePath)) {
      console.warn(`[GPU] Файл не найден: ${exePath}`);
      return resolve(false);
    }

    const value = modeToPrefValue(mode);
    const cmd = `reg add "${REG_KEY}" /v "${exePath}" /t REG_SZ /d "${value}" /f`;

    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        console.warn(`[GPU] Не удалось для ${exePath}: ${err.message}`);
        return resolve(false);
      }
      console.log(`[GPU] ${exePath} -> ${mode} (${value})`);
      resolve(true);
    });
  });
}

// Прочитать текущий режим для .exe из реестра.
// Возвращает null, если запись отсутствует.
export function getGpuPreferenceForExe(exePath: string): GpuMode | null {
  if (process.platform !== 'win32') return null;

  try {
    const output = execSync(
      `reg query "${REG_KEY}" /v "${exePath}"`,
      { encoding: 'utf-8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    );

    const match = output.match(/GpuPreference=(\d)/);
    if (!match) return null;

    const num = match[1];
    if (num === '2') return 'high';
    if (num === '1') return 'low';
    return 'auto';
  } catch {
    return null;
  }
}

// Найти все java.exe в ~/.gromclient/runtime/<runtime>/bin/
export function findAllJavaExes(): string[] {
  const result: string[] = [];
  if (!fs.existsSync(RUNTIME_DIR)) return result;

  try {
    const runtimes = fs.readdirSync(RUNTIME_DIR, { withFileTypes: true });
    for (const rt of runtimes) {
      if (!rt.isDirectory()) continue;
      const javaExe = path.join(RUNTIME_DIR, rt.name, 'bin', 'java.exe');
      if (fs.existsSync(javaExe)) {
        result.push(javaExe);
      }
    }
  } catch (err) {
    console.warn('[GPU] Ошибка чтения runtime:', err);
  }

  return result;
}

// Применить режим для java.exe и лаунчера.
// Если mode === 'auto' — прописываем GpuPreference=0.
export async function applyGpuMode(mode: GpuMode): Promise<{
  javaResults: { path: string; success: boolean }[];
  launcherResult: { path: string; success: boolean };
}> {
  const results = {
    javaResults: [] as { path: string; success: boolean }[],
    launcherResult: { path: '', success: false },
  };

  if (process.platform !== 'win32') {
    return results;
  }

  // 1. Все java.exe
  const javaExes = findAllJavaExes();
  for (const javaExe of javaExes) {
    const ok = await setGpuPreferenceForExe(javaExe, mode);
    results.javaResults.push({ path: javaExe, success: ok });
  }

  // 2. Сам лаунчер (Grom Client.exe или electron.exe)
  const okLauncher = await setGpuPreferenceForExe(process.execPath, mode);
  results.launcherResult = { path: process.execPath, success: okLauncher };

  return results;
}

// Дефолтная настройка при старте — High Performance.
export async function applyDefaultGpuPreferences(): Promise<void> {
  if (process.platform !== 'win32') return;

  console.log('[GPU] Автонастройка при старте: High Performance');

  const javaExes = findAllJavaExes();
  if (javaExes.length === 0) {
    console.log('[GPU] java.exe ещё не скачана, настроим при следующем запуске');
  }
  for (const javaExe of javaExes) {
    await setGpuPreferenceForExe(javaExe, 'high');
  }
  await setGpuPreferenceForExe(process.execPath, 'high');
}

// Статус: для каждого java.exe + лаунчера — текущий режим.
export function getGpuStatus(): {
  java: { path: string; mode: GpuMode | null }[];
  launcher: { path: string; mode: GpuMode | null };
} {
  const javas = findAllJavaExes().map((p) => ({
    path: p,
    mode: getGpuPreferenceForExe(p),
  }));

  return {
    java: javas,
    launcher: {
      path: process.execPath,
      mode: getGpuPreferenceForExe(process.execPath),
    },
  };
}