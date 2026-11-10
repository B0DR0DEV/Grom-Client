import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

let terminalProcess: ChildProcessWithoutNullStreams | null = null;
let onDataCallback: ((data: string) => void) | null = null;
let onExitCallback: ((code: number) => void) | null = null;

function getGromAiDir(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, '../../grom-ai');
  }
  return path.join(process.resourcesPath, 'grom-ai');
}

function getScriptPath(): string {
  return path.join(getGromAiDir(), 'grom_slm.js');
}

export function isTerminalRunning(): boolean {
  return terminalProcess !== null;
}

export function spawnTerminal(): { success: boolean; error?: string } {
  if (terminalProcess) {
    return { success: false, error: 'Терминал уже запущен' };
  }

  const gromAiDir = getGromAiDir();
  const scriptPath = getScriptPath();

  if (!fs.existsSync(gromAiDir)) {
    return { success: false, error: `Папка grom-ai не найдена: ${gromAiDir}` };
  }
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Скрипт не найден: ${scriptPath}` };
  }

  try {
    // ═══════════════════════════════════════════════════════
    // ИСПОЛЬЗУЕМ ELECTRON КАК NODE.JS
    // process.execPath — это наш Grom Client.exe (или electron.exe в dev)
    // Флаг ELECTRON_RUN_AS_NODE превращает его в чистый Node.js
    // Node.js от пользователя НЕ ТРЕБУЕТСЯ
    // ═══════════════════════════════════════════════════════
    terminalProcess = spawn(process.execPath, ['grom_slm.js'], {
      cwd: gromAiDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        FORCE_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    terminalProcess.stdout?.setEncoding('utf-8');
    terminalProcess.stderr?.setEncoding('utf-8');

    terminalProcess.stdout?.on('data', (data: string) => {
      if (onDataCallback) onDataCallback(data);
    });
    terminalProcess.stderr?.on('data', (data: string) => {
      if (onDataCallback) onDataCallback(data);
    });

    terminalProcess.on('exit', (code) => {
      if (onExitCallback) onExitCallback(code ?? 0);
      terminalProcess = null;
    });

    terminalProcess.on('error', (err) => {
      if (onDataCallback) onDataCallback(`\r\n[Ошибка] ${err.message}\r\n`);
      terminalProcess = null;
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка запуска терминала' };
  }
}

export function writeToTerminal(data: string): void {
  if (!terminalProcess) return;
  try {
    terminalProcess.stdin.write(data);
  } catch {}
}

export function killTerminal(): void {
  if (!terminalProcess) return;
  try {
    terminalProcess.kill();
  } catch {}
  terminalProcess = null;
}

export function onTerminalData(cb: (data: string) => void): void {
  onDataCallback = cb;
}

export function onTerminalExit(cb: (code: number) => void): void {
  onExitCallback = cb;
}