process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getConfig, setConfig, GromConfig } from './config';
import { findJava, downloadJavaRuntime } from './java';
import { getMinecraftVersions, getRequiredJavaForMinecraftVersion, installMinecraft, launchMinecraft } from './minecraft';
import {
  searchMods,
  downloadMod,
  searchModpacks,
  downloadModpack,
  getModCompatibleVersions,
  getPopularMods,
  downloadProjectContent,
} from './mods';
import { downloadElySkin, downloadElyCape, getElySkinUrl } from './skins';
import { applySavedSkinToMicrosoft, getMinecraftLaunchSession, getSavedMicrosoftAccount, loginWithMicrosoft, logoutMicrosoft } from './microsoftAuth';
import { listInstances, createInstance, deleteInstance, getInstanceModsDir, getInstancePath } from './instances';
import { checkModUpdates, updateMod } from './modUpdater';
import { generateModpack } from './ai';
import { installLoader } from './loaderInstaller';
import { listPetFrames } from './pets';
import { listWorlds, deleteWorld, backupWorld, listScreenshots } from './worlds';
import { exportInstanceToMrpack, importMrpackToInstance } from './mrpack';
import { FPS_MODS, detectPCLevel, recommendRam, checkInstalledFpsMods, installFpsMods, uninstallFpsMods } from './fpsBoost';
import {
  spawnTerminal,
  writeToTerminal,
  killTerminal,
  isTerminalRunning,
  onTerminalData,
  onTerminalExit,
} from './terminal';
import {
  getBuiltinIcons,
  getIconForTheme,
  getBuiltinIconDataUrl,
  setWindowIcon,
  pickCustomIcon,
  getCustomIconPath,
  getCustomIconDataUrl,
  clearCustomIcon,
} from './appIcon';
import { applyDefaultGpuPreferences, applyGpuMode, getGpuStatus, GpuMode } from './gpuPreference';
import { addLaunch, finishLaunch, getGameStats, diagnoseGame, scanMods, checkMinecraftFiles, monitorSession } from './maintenance';
import { exportShareCode, importShareCode, previewShareCode } from './shareCode';
import { prepareSkinLoader } from './skinLoader';
import { detectSources, scanSource, runImport } from './importer';
import { startTunnel, stopTunnel, getTunnelState, getRelay, setRelay, detectLanPort } from './tunnel';

app.disableHardwareAcceleration();

let win: BrowserWindow | null = null;
let gameProcess: any = null;
let currentLaunchRecord: number | null = null;
let stopSessionMonitor: (() => void) | null = null;
let lastRunDir = '';

const GROM_DIR = path.join(os.homedir(), '.gromclient');

const isDev = !app.isPackaged;
const ASSETS_BASE = isDev
  ? path.join(__dirname, '../../assets')
  : path.join(process.resourcesPath, 'assets');

const BACKGROUNDS_DIR = path.join(ASSETS_BASE, 'backgrounds');
const CLOUDS_DIR = path.join(ASSETS_BASE, 'clouds');
const UI_DIR = path.join(ASSETS_BASE, 'ui');

function ensureGromDir() {
  if (!fs.existsSync(GROM_DIR)) fs.mkdirSync(GROM_DIR, { recursive: true });
}

function resolveInitialIcon(): string | null {
  const cfg = getConfig();
  if (cfg.appIcon === 'custom') {
    return getCustomIconPath();
  }
  if (cfg.appIcon) {
    const builtin = getBuiltinIcons();
    if (builtin[cfg.appIcon]) return builtin[cfg.appIcon];
  }
  return getIconForTheme(cfg.theme);
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const initialIcon = resolveInitialIcon();

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1f12',
    title: 'Grom Client',
    // Use the app's own title-bar controls so they match the active theme.
    frame: false,
    autoHideMenuBar: true,
    show: false,
    ...(initialIcon ? { icon: initialIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));

  win.once('ready-to-show', () => win?.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../index.html'));
  }

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('❌ LOAD FAILED:', code, desc, url);
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[RENDERER ${level}] ${message} (${sourceId}:${line})`);
  });

  onTerminalData((data) => {
    win?.webContents.send('terminal:data', data);
  });
  onTerminalExit((code) => {
    win?.webContents.send('terminal:exit', code);
  });

  win.on('closed', () => {
    killTerminal();
  });
}

ipcMain.handle('window:minimize', () => {
  if (!win || win.isDestroyed()) return false;
  win.minimize();
  return true;
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!win || win.isDestroyed()) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:isMaximized', () => !!win && !win.isDestroyed() && win.isMaximized());

ipcMain.handle('window:close', () => {
  if (!win || win.isDestroyed()) return false;
  win.close();
  return true;
});

ipcMain.handle('java:find', (_e, minimumMajorVersion?: number) => findJava(typeof minimumMajorVersion === 'number' ? minimumMajorVersion : undefined));
ipcMain.handle('java:getRequired', async (_e, mcVersion: string) => getRequiredJavaForMinecraftVersion(mcVersion || '1.21'));

ipcMain.handle('java:download', async (_e, mcVersion: string) => {
  const required = await getRequiredJavaForMinecraftVersion(mcVersion || '1.21');
  try {
    const javaPath = await downloadJavaRuntime(required, (msg, percent) => {
      win?.webContents.send('minecraft:status', { stage: 'installing', message: msg, progress: percent });
    });
    return { success: true, path: javaPath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config:set', (_e, key: keyof GromConfig, value: any) => { setConfig(key, value); return true; });
ipcMain.handle('config:get', () => getConfig());
ipcMain.handle('config:getGameDir', () => { ensureGromDir(); return GROM_DIR; });

ipcMain.handle('system:getTotalRam', () => Math.floor(os.totalmem() / 1024 / 1024));
ipcMain.handle('system:getScreenSize', () => {
  const { screen } = require('electron');
  const p = screen.getPrimaryDisplay();
  return { width: p.size.width, height: p.size.height };
});
ipcMain.handle('system:openFolder', async (_e, folder: string) => {
  const target = folder === 'game' ? GROM_DIR : folder;
  if (fs.existsSync(target)) { await shell.openPath(target); return true; }
  return false;
});
ipcMain.handle('system:openExternal', async (_e, url: string) => { await shell.openExternal(url); return true; });

ipcMain.handle('pick-file', async (_e, type: 'skin' | 'cape') => {
  const title = type === 'skin' ? 'Выбери скин (PNG 64×64)' : 'Выбери плащ (PNG 64×32)';
  const result = await dialog.showOpenDialog({ title, filters: [{ name: 'PNG', extensions: ['png'] }], properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const stats = fs.statSync(filePath);
  if (stats.size > 1024 * 1024) throw new Error('Файл слишком большой (макс. 1 МБ)');

  ensureGromDir();
  const targetDir = path.join(GROM_DIR, type === 'skin' ? 'skins' : 'capes');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const nickname = getConfig().nickname || 'Player';
  const targetPath = path.join(targetDir, `${nickname}.png`);
  fs.copyFileSync(filePath, targetPath);
  setConfig(type === 'skin' ? 'skinPath' : 'capePath', targetPath);

  const buffer = fs.readFileSync(targetPath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
});

ipcMain.handle('load-saved-file', (_e, type: 'skin' | 'cape') => {
  const config = getConfig();
  const filePath = type === 'skin' ? config.skinPath : config.capePath;
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
});

ipcMain.handle('skin:saveData', (_e, dataUrl: string) => {
  try {
    if (typeof dataUrl !== 'string' || dataUrl.length > 400_000) throw new Error('PNG слишком большой (макс. 256 КБ).');
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error('Ожидается PNG-файл скина.');
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > 256 * 1024 || buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a' || buffer.readUInt32BE(16) !== 64 || buffer.readUInt32BE(20) !== 64) {
      throw new Error('Скин должен быть PNG размером 64×64 пикселя и не больше 256 КБ.');
    }
    ensureGromDir();
    const skinsDir = path.join(GROM_DIR, 'skins');
    fs.mkdirSync(skinsDir, { recursive: true });
    const nickname = (getConfig().nickname || 'Player').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || 'Player';
    const targetPath = path.join(skinsDir, `${nickname}.png`);
    fs.writeFileSync(targetPath, buffer);
    setConfig('skinPath', targetPath);
    return { success: true, path: targetPath, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Не удалось сохранить скин.' };
  }
});

ipcMain.handle('skin:applyMicrosoft', async (_e, variant: 'classic' | 'slim') => {
  try {
    const cfg = getConfig();
    if (cfg.accountType !== 'microsoft' || !getSavedMicrosoftAccount()) throw new Error('Сначала войди в Minecraft через Microsoft.');
    if (!cfg.skinPath) throw new Error('Сначала сохрани скин.');
    await applySavedSkinToMicrosoft(cfg.skinPath, variant === 'slim' ? 'slim' : 'classic');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Не удалось применить скин.' };
  }
});

ipcMain.handle('microsoft:login', async () => {
  try {
    const profile = await loginWithMicrosoft((url) => shell.openExternal(url));
    setConfig('nickname', profile.name);
    setConfig('accountType', 'microsoft');
    return { success: true, profile };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Не удалось войти через Microsoft.' };
  }
});

ipcMain.handle('microsoft:account', () => getSavedMicrosoftAccount());

ipcMain.handle('microsoft:logout', () => {
  logoutMicrosoft();
  if (getConfig().accountType === 'microsoft') setConfig('accountType', 'offline');
  return { success: true };
});

ipcMain.handle('ely:downloadSkin', async (_e, nickname: string) => {
  try {
    const skinPath = await downloadElySkin(nickname);
    setConfig('skinPath', skinPath);
    return { success: true, path: skinPath, url: getElySkinUrl(nickname) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ely:downloadCape', async (_e, nickname: string) => {
  try {
    const capePath = await downloadElyCape(nickname);
    setConfig('capePath', capePath);
    return { success: true, path: capePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ely:getSkinUrl', (_e, nickname: string) => getElySkinUrl(nickname));

ipcMain.handle('ui:getButtonTexture', () => {
  const buttonPath = path.join(UI_DIR, 'button.png');
  if (!fs.existsSync(buttonPath)) return null;
  return `data:image/png;base64,${fs.readFileSync(buttonPath).toString('base64')}`;
});

ipcMain.handle('ui:getNavIcons', () => {
  const navDir = path.join(UI_DIR, 'nav');
  const icons: Record<string, string> = {};
  if (!fs.existsSync(navDir)) return icons;

  const names = ['home', 'news', 'mods', 'modpacks', 'messenger', 'visuals', 'settings', 'about', 'worlds', 'terminal', 'addons'];
  for (const name of names) {
    const filePath = path.join(navDir, `${name}.png`);
    if (fs.existsSync(filePath)) {
      icons[name] = `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
    }
  }
  return icons;
});

ipcMain.handle('pets:getFrames', (_e, petName: string) => {
  return listPetFrames(petName);
});

ipcMain.handle('clouds:list', () => {
  if (!fs.existsSync(CLOUDS_DIR)) return [];
  const files = fs.readdirSync(CLOUDS_DIR).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'));
  return files.map((f) => {
    const buffer = fs.readFileSync(path.join(CLOUDS_DIR, f));
    const ext = path.extname(f).slice(1) === 'jpg' ? 'jpeg' : path.extname(f).slice(1);
    return { name: f, dataUrl: `data:image/${ext};base64,${buffer.toString('base64')}` };
  });
});

ipcMain.handle('backgrounds:list', () => {
  if (!fs.existsSync(BACKGROUNDS_DIR)) return [];
  const files = fs.readdirSync(BACKGROUNDS_DIR).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'));
  return files.map((f) => {
    const buffer = fs.readFileSync(path.join(BACKGROUNDS_DIR, f));
    const ext = path.extname(f).slice(1) === 'jpg' ? 'jpeg' : path.extname(f).slice(1);
    return { name: f.replace(/\.(png|jpg)$/, ''), dataUrl: `data:image/${ext};base64,${buffer.toString('base64')}` };
  });
});

ipcMain.handle('fonts:pick', async () => {
  const result = await dialog.showOpenDialog({ title: 'Выбери шрифт', filters: [{ name: 'Шрифты', extensions: ['ttf', 'otf'] }], properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const stats = fs.statSync(filePath);
  if (stats.size > 5 * 1024 * 1024) throw new Error('Шрифт слишком большой (макс. 5 МБ)');

  ensureGromDir();
  const targetDir = path.join(GROM_DIR, 'fonts');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const fileName = path.basename(filePath);
  const targetPath = path.join(targetDir, fileName);
  fs.copyFileSync(filePath, targetPath);
  setConfig('customFontPath', targetPath);
  setConfig('customFontName', fileName.replace(/\.(ttf|otf)$/, ''));

  const buffer = fs.readFileSync(targetPath);
  return { name: fileName.replace(/\.(ttf|otf)$/, ''), dataUrl: `data:font/ttf;base64,${buffer.toString('base64')}` };
});

ipcMain.handle('fonts:loadSaved', () => {
  const config = getConfig();
  if (!config.customFontPath || !fs.existsSync(config.customFontPath)) return null;
  const buffer = fs.readFileSync(config.customFontPath);
  const fileName = path.basename(config.customFontPath);
  return { name: fileName.replace(/\.(ttf|otf)$/, ''), dataUrl: `data:font/ttf;base64,${buffer.toString('base64')}` };
});

ipcMain.handle('minecraft:getVersions', async () => await getMinecraftVersions());

// Официальные новости Minecraft из launcher content API. Возвращаем только безопасные поля.
let minecraftNewsCache: { fetchedAt: number; items: any[] } | null = null;
ipcMain.handle('news:minecraft', async () => {
  const now = Date.now();
  if (minecraftNewsCache && now - minecraftNewsCache.fetchedAt < 10 * 60 * 1000) {
    return { success: true, cached: true, items: minecraftNewsCache.items };
  }
  try {
    const response = await fetch('https://launchercontent.mojang.com/news.json', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'GromClient/1.4.4' },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload: any = await response.json();
    const raw = Array.isArray(payload?.entries) ? payload.entries : Array.isArray(payload?.news) ? payload.news : [];
    const items = raw.slice(0, 30).map((item: any, index: number) => {
      const rawUrl = typeof item.readMoreLink === 'string' ? item.readMoreLink :
        typeof item.contentPath === 'string' ? `https://www.minecraft.net${item.contentPath}` : '';
      let url = '';
      try { const parsed = new URL(rawUrl, 'https://www.minecraft.net'); if (parsed.protocol === 'https:' && /(^|\.)minecraft\.net$/.test(parsed.hostname)) url = parsed.toString(); } catch {}
      let image = '';
      const imagePath = typeof item.image?.url === 'string' ? item.image.url : typeof item.image === 'string' ? item.image : '';
      try { const parsed = new URL(imagePath, 'https://launchercontent.mojang.com'); if (parsed.protocol === 'https:' && /(^|\.)mojang\.com$/.test(parsed.hostname)) image = parsed.toString(); } catch {}
      return {
        id: String(item.id || item.contentPath || index),
        title: String(item.title || item.headline || 'Minecraft news').slice(0, 180),
        date: String(item.date || item.publishedAt || item.createdAt || ''),
        category: String(item.category || item.type || 'Minecraft').slice(0, 80),
        text: String(item.text || item.description || item.summary || '').replace(/<[^>]*>/g, ' ').slice(0, 500),
        url, image,
      };
    }).filter((item: any) => item.title);
    if (!items.length) throw new Error('В официальном ответе нет новостей в ожидаемом формате');
    minecraftNewsCache = { fetchedAt: now, items };
    return { success: true, cached: false, items };
  } catch (error: any) {
    if (minecraftNewsCache?.items?.length) return { success: true, cached: true, stale: true, items: minecraftNewsCache.items };
    return { success: false, error: String(error?.message || 'Не удалось загрузить новости'), items: [] };
  }
});

// Normalize the launch pipeline into one monotonic overall progress value.
// Individual download helpers use their own local 0-100 ranges, so pass those
// through a phase map instead of letting the UI jump backwards mid-launch.
function getOverallLaunchProgress(message: string, rawProgress: number): number {
  const text = String(message || '').toLocaleLowerCase('ru-RU');
  const raw = Math.max(0, Math.min(100, Number(rawProgress) || 0));
  if (/java|runtime|манифест/.test(text)) return Math.round(raw * 0.15);
  if (/получение данных версии/.test(text)) return 17;
  if (/скачивание клиента/.test(text)) return 22;
  if (/скачивание библиотек/.test(text)) return 28;
  if (/библиотеки:\s*\d+\s*\//.test(text)) return 28 + Math.round((Math.max(0, Math.min(70, raw - 20)) / 70) * 39);
  if (/скачивание ресурсов|загрузка списка ассетов/.test(text)) return 68;
  if (/ассеты:\s*\d+\s*\//.test(text)) return 69 + Math.round((Math.max(0, Math.min(4, raw - 96)) / 4) * 6);
  if (/minecraft .* установлен/.test(text)) return 76;
  if (/подготовка версии/.test(text)) return 79;
  if (/проверка библиотек:\s*\d+\s*\//.test(text)) return 84 + Math.max(0, Math.min(6, raw - 15));
  if (/проверка библиотек/.test(text)) return 84;
  if (/распаковка натив/.test(text)) return 89;
  if (/распаковано/.test(text)) return 93;
  if (/запуск игры|игра запущена/.test(text)) return 98;
  if (/запуск (fabric|forge|neoforge)/.test(text)) return 16;
  return Math.min(95, Math.round(12 + raw * 0.7));
}

ipcMain.handle('minecraft:launch', async (_e, options) => {
  try {
    if (gameProcess) return { success: false, error: 'Игра уже запущена' };

    const cfg = getConfig();
    let auth: { uuid: string; accessToken: string } | undefined;
    let launchNickname = options.nickname;
    if (cfg.accountType === 'microsoft') {
      const session = await getMinecraftLaunchSession();
      if (!session) return { success: false, error: 'Microsoft-аккаунт не подключён. Войди через Microsoft заново.' };
      auth = { uuid: session.uuid, accessToken: session.accessToken };
      launchNickname = session.name;
      setConfig('nickname', session.name);
    }

    const instanceDir = options.instance ? getInstancePath(String(options.instance)) : '';
    const runDir = instanceDir && fs.existsSync(instanceDir) ? instanceDir : GROM_DIR;
    fs.mkdirSync(runDir, { recursive: true });
    lastRunDir = runDir;
    // Скины других игроков (и твой собственный в оффлайне) — CustomSkinLoader для модовых версий.
    win?.webContents.send('minecraft:status', { stage: 'installing', message: 'Подключаю скины игроков…', progress: 1 });
    console.log('[skins]', await prepareSkinLoader(runDir, String(options.version || ''), String(options.loader || 'Vanilla')));
    let lastReportedLaunchProgress = 0;
    const result = await launchMinecraft({
      nickname: launchNickname,
      version: options.version,
      loader: options.loader || 'Vanilla',
      gameDir: GROM_DIR,
      ram: options.ram,
      width: options.width,
      height: options.height,
      fullscreen: options.fullscreen,
      auth,
      fpsBoost: cfg.fpsBoostEnabled && cfg.fpsBoostAikar,
      server: typeof options.server === 'string' ? options.server : undefined,
      runDir,
      onProgress: (msg: string, percent: number) => {
        const overallProgress = Math.max(lastReportedLaunchProgress, getOverallLaunchProgress(msg, percent));
        lastReportedLaunchProgress = overallProgress;
        win?.webContents.send('minecraft:status', { stage: 'installing', message: msg, progress: overallProgress });
      },
    });

    if (!result.success) return result;

    gameProcess = result.process;
    currentLaunchRecord = addLaunch(options.version || 'unknown', options.loader || 'Vanilla', options.instance, options.server);
    stopSessionMonitor?.();
    stopSessionMonitor = monitorSession(currentLaunchRecord, result.process?.pid, runDir);
    win?.webContents.send('minecraft:status', { stage: 'running', message: 'Игра запущена', progress: 100 });

    result.process?.on('close', (code: number | null) => {
      stopSessionMonitor?.(); stopSessionMonitor = null;
      if (currentLaunchRecord !== null) finishLaunch(currentLaunchRecord, code ?? undefined);
      currentLaunchRecord = null;
      gameProcess = null;
      win?.webContents.send('minecraft:status', { stage: 'stopped', message: 'Игра закрыта', progress: 0 });
      win?.show();
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('loader:install', async (_e, loader: string, mcVersion: string) => {
  const result = await installLoader(loader, mcVersion, GROM_DIR, (msg, percent) => {
    win?.webContents.send('minecraft:status', { stage: 'installing', message: msg, progress: percent });
  });
  return result;
});

// ═══════════════════════════════════════════════════════
// ДОПОЛНЕНИЯ (моды / ресурспаки / шейдеры)
// ═══════════════════════════════════════════════════════

ipcMain.handle('mods:search', async (_e, query: string, gameVersion: string, loader: string, projectType?: string) => {
  try {
    return await searchMods(query, gameVersion, loader, projectType || 'mod');
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('mods:getPopular', async (_e, gameVersion: string, loader: string) => {
  try { return await getPopularMods(gameVersion, loader, 'mod'); } catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('mods:getPopularByType', async (_e, gameVersion: string, loader: string, projectType: string) => {
  try { return await getPopularMods(gameVersion, loader, projectType); } catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('mods:getCompatibleVersions', async (_e, projectId: string) => {
  try { return await getModCompatibleVersions(projectId); } catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('mods:download', async (_e, projectId: string, gameVersion: string, loader: string, instanceName: string) => {
  try {
    const modsDir = instanceName ? getInstanceModsDir(instanceName) : path.join(GROM_DIR, 'mods');
    const filename = await downloadMod(projectId, gameVersion, loader, modsDir);
    return { success: true, filename };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

/**
 * Универсальная установка: мод / ресурспак / шейдер.
 * Куда кладём:
 *   mod         → ~/.gromclient/mods/ (или instance/mods/)
 *   resourcepack → ~/.gromclient/resourcepacks/
 *   shader      → ~/.gromclient/shaderpacks/
 */
ipcMain.handle('mods:installByType', async (
  _e,
  projectId: string,
  gameVersion: string,
  loader: string,
  projectType: string,
  instanceName?: string
) => {
  try {
    let targetDir: string;

    if (projectType === 'mod') {
      targetDir = instanceName ? getInstanceModsDir(instanceName) : path.join(GROM_DIR, 'mods');
    } else if (projectType === 'resourcepack') {
      targetDir = path.join(GROM_DIR, 'resourcepacks');
    } else if (projectType === 'shader') {
      targetDir = path.join(GROM_DIR, 'shaderpacks');
    } else {
      throw new Error(`Неизвестный тип: ${projectType}`);
    }

    const filename = await downloadProjectContent(projectId, gameVersion, loader, targetDir, projectType);
    return { success: true, filename, targetDir };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:importLocal', async (_e, filePath: string, instanceName?: string) => {
  try {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) throw new Error('Исходный файл не найден. Перетащи JAR-файл ещё раз.');
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.jar') throw new Error('Можно добавлять только файлы модов .jar');
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) throw new Error('Файл пустой или это не обычный файл.');
    if (stat.size > 500 * 1024 * 1024) throw new Error('Файл слишком большой (максимум 500 МБ).');
    const modsDir = instanceName ? getInstanceModsDir(instanceName) : path.join(GROM_DIR, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const name = path.basename(filePath).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    let target = path.join(modsDir, name);
    if (fs.existsSync(target)) {
      const base = path.basename(name, '.jar');
      const existing = fs.readFileSync(target); const incoming = fs.readFileSync(filePath);
      if (existing.equals(incoming)) return { success: true, filename: name, duplicate: true };
      target = path.join(modsDir, `${base}-${Date.now()}.jar`);
    }
    fs.copyFileSync(filePath, target, fs.constants.COPYFILE_EXCL);
    return { success: true, filename: path.basename(target), targetDir: modsDir };
  } catch (err: any) { return { success: false, error: err.message || 'Не удалось добавить мод' }; }
});

ipcMain.handle('maintenance:stats', () => getGameStats());

// ── Код сборки / туннель ──
ipcMain.handle('share:export', async (_e, instanceName: string) => {
  try { return { success: true, ...(await exportShareCode(instanceName)) }; } catch (err: any) { return { success: false, error: err.message }; }
});
ipcMain.handle('share:preview', (_e, code: string) => {
  try { return { success: true, ...previewShareCode(code) }; } catch (err: any) { return { success: false, error: err.message }; }
});
ipcMain.handle('share:import', async (_e, code: string, name?: string) => {
  try {
    return { success: true, ...(await importShareCode(code, name, (message, progress) => win?.webContents.send('share:progress', { message, progress }))) };
  } catch (err: any) { return { success: false, error: err.message }; }
});
ipcMain.handle('import:detect', () => detectSources());
ipcMain.handle('import:pick', async () => {
  const r = await dialog.showOpenDialog({ title: 'Выбери папку игры другого лаунчера (обычно .minecraft)', defaultPath: process.env.APPDATA || os.homedir(), properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('import:scan', async (_e, dir: string) => {
  try { return { success: true, ...(await scanSource(String(dir))) }; } catch (err: any) { return { success: false, error: err.message }; }
});
ipcMain.handle('import:run', async (_e, src: string, instance: string, keys: string[]) => {
  try {
    const dest = instance ? getInstancePath(String(instance)) : GROM_DIR;
    if (instance && !fs.existsSync(dest)) throw new Error(`Сборка «${instance}» не найдена`);
    fs.mkdirSync(dest, { recursive: true });
    const res = await runImport(String(src), dest, Array.isArray(keys) ? keys.map(String) : [], (p) => win?.webContents.send('import:progress', p));
    return { success: true, ...res, dest };
  } catch (err: any) { return { success: false, error: err.message }; }
});
ipcMain.handle('tunnel:state', () => getTunnelState());
ipcMain.handle('tunnel:getRelay', () => getRelay());
ipcMain.handle('tunnel:setRelay', (_e, host: string, port: number) => { setRelay({ host: String(host || ''), port: Number(port) || 7000 }); return { success: true }; });
ipcMain.handle('tunnel:detectPort', () => detectLanPort(lastRunDir || GROM_DIR));
ipcMain.handle('tunnel:start', async (_e, localPort: number) => {
  try {
    const st = await startTunnel(Number(localPort), (s) => win?.webContents.send('tunnel:changed', s));
    return { success: true, ...st };
  } catch (err: any) { return { success: false, error: err.message }; }
});
ipcMain.handle('tunnel:stop', () => { stopTunnel(); return { success: true }; });
ipcMain.handle('maintenance:diagnose', () => diagnoseGame(lastRunDir || GROM_DIR));
ipcMain.handle('maintenance:scanMods', (_e, instanceName?: string) => {
  const modsDir = instanceName ? getInstanceModsDir(instanceName) : path.join(GROM_DIR, 'mods');
  return scanMods(modsDir);
});
ipcMain.handle('maintenance:checkMinecraft', async (_e, version?: string) => {
  if (!version) return checkMinecraftFiles(GROM_DIR);
  try {
    if (gameProcess) return { ...checkMinecraftFiles(GROM_DIR), ok: false, message: 'Сначала закрой Minecraft, затем запускай проверку файлов.' };
    await installMinecraft(version, GROM_DIR, (message, progress) => {
      win?.webContents.send('minecraft:status', { stage: 'installing', message, progress });
    });
    const structure = checkMinecraftFiles(GROM_DIR);
    return { ...structure, ok: true, version, message: `Версия Minecraft ${version} проверена: клиентский JAR, библиотеки и ресурсы сверены с метаданными Mojang. Недостающие и повреждённые файлы восстановлены.` };
  } catch (err: any) {
    return { ...checkMinecraftFiles(GROM_DIR), ok: false, version, message: `Проверка ${version} не завершена: ${err?.message || 'ошибка скачивания'}. Проверь подключение к интернету и повтори попытку.` };
  }
});
ipcMain.handle('maintenance:openLog', async () => {
  const result = diagnoseGame(lastRunDir || GROM_DIR);
  if (!result.found || !result.file) return { success: false, error: 'Логов пока нет.' };
  const target = path.join(lastRunDir || GROM_DIR, result.file === 'latest.log' ? 'logs' : 'crash-reports', result.file);
  await shell.openPath(target); return { success: true };
});

ipcMain.handle('mods:openContentFolder', async (_e, projectType: string) => {
  let folder = '';
  if (projectType === 'mod') folder = path.join(GROM_DIR, 'mods');
  else if (projectType === 'resourcepack') folder = path.join(GROM_DIR, 'resourcepacks');
  else if (projectType === 'shader') folder = path.join(GROM_DIR, 'shaderpacks');
  else folder = GROM_DIR;

  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  await shell.openPath(folder);
  return true;
});

ipcMain.handle('mods:checkUpdates', async (_e, instanceName: string, gameVersion: string, loader: string) => {
  try {
    const modsDir = instanceName ? getInstanceModsDir(instanceName) : path.join(GROM_DIR, 'mods');
    const updates = await checkModUpdates(modsDir, gameVersion, loader);
    return { success: true, updates };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:update', async (_e, instanceName: string, oldFileName: string, downloadUrl: string, newFileName: string) => {
  try {
    const modsDir = instanceName ? getInstanceModsDir(instanceName) : path.join(GROM_DIR, 'mods');
    await updateMod(modsDir, oldFileName, downloadUrl, newFileName);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('modpacks:search', async (_e, query: string, gameVersion: string) => {
  try { return await searchModpacks(query, gameVersion); } catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('modpacks:download', async (_e, projectId: string, gameVersion: string, instanceName: string) => {
  try {
    const targetDir = getInstancePath(instanceName);
    const filename = await downloadModpack(projectId, gameVersion, targetDir);
    return { success: true, filename };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('instances:list', () => listInstances());

ipcMain.handle('instances:create', (_e, name: string, version: string, loader: string) => {
  try { return { success: true, instance: createInstance(name, version, loader) }; }
  catch (err: any) { return { success: false, error: err.message }; }
});

ipcMain.handle('instances:delete', (_e, name: string) => {
  try { deleteInstance(name); return { success: true }; }
  catch (err: any) { return { success: false, error: err.message }; }
});

ipcMain.handle('instances:exportMrpack', async (_e, instanceName: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Экспорт сборки',
    defaultPath: `${instanceName}.mrpack`,
    filters: [{ name: 'Modrinth Pack', extensions: ['mrpack'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  try {
    await exportInstanceToMrpack(getInstancePath(instanceName), result.filePath);
    return { success: true, path: result.filePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('instances:importMrpack', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Импорт сборки',
    filters: [{ name: 'Modrinth Pack', extensions: ['mrpack'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false };
  try {
    const instancesDir = path.join(GROM_DIR, 'instances');
    const instanceName = await importMrpackToInstance(result.filePaths[0], instancesDir);
    return { success: true, instanceName };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('worlds:list', (_e, instanceName?: string) => {
  try { return listWorlds(GROM_DIR, instanceName); } catch { return []; }
});

ipcMain.handle('worlds:delete', (_e, worldPath: string) => {
  try { deleteWorld(GROM_DIR, worldPath); return { success: true }; }
  catch (err: any) { return { success: false, error: err.message }; }
});

ipcMain.handle('worlds:backup', (_e, worldPath: string) => {
  try {
    const backupsDir = path.join(GROM_DIR, 'backups');
    const dest = backupWorld(GROM_DIR, worldPath, backupsDir);
    return { success: true, path: dest };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('screenshots:list', (_e, instanceName?: string) => {
  try { return listScreenshots(GROM_DIR, instanceName); } catch { return []; }
});

ipcMain.handle('ai:generateModpack', async (_e, apiKey: string, prompt: string) => {
  try {
    const pack = await generateModpack(apiKey, prompt);
    return { success: true, pack };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// FPS BOOST IPC
ipcMain.handle('fps:getMods', () => FPS_MODS);

ipcMain.handle('fps:detect', () => {
  const totalRamMB = Math.floor(os.totalmem() / 1024 / 1024);
  const level = detectPCLevel(totalRamMB);
  const recommendedRam = recommendRam(totalRamMB, level);
  return { totalRamMB, level, recommendedRam };
});

ipcMain.handle('fps:checkMods', () => {
  const modsDir = path.join(GROM_DIR, 'mods');
  return checkInstalledFpsMods(modsDir);
});

ipcMain.handle('fps:install', async (_e, version: string, loader: string, selectedSlugs: string[]) => {
  try {
    const modsDir = path.join(GROM_DIR, 'mods');
    const result = await installFpsMods(version, loader, modsDir, selectedSlugs, (msg, percent) => {
      win?.webContents.send('minecraft:status', { stage: 'installing', message: msg, progress: percent });
    });
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fps:uninstall', () => {
  try {
    const modsDir = path.join(GROM_DIR, 'mods');
    const removed = uninstallFpsMods(modsDir);
    return { success: true, removed };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fps:openModsFolder', async () => {
  const modsDir = path.join(GROM_DIR, 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
  await shell.openPath(modsDir);
  return true;
});

// TERMINAL IPC
ipcMain.handle('terminal:spawn', () => {
  return spawnTerminal();
});

ipcMain.handle('terminal:write', (_e, data: string) => {
  writeToTerminal(data);
  return true;
});

ipcMain.handle('terminal:kill', () => {
  killTerminal();
  return true;
});

ipcMain.handle('terminal:isRunning', () => isTerminalRunning());

// APP ICON IPC
ipcMain.handle('icon:list', () => {
  return getBuiltinIcons();
});

ipcMain.handle('icon:getBuiltinPreview', (_e, key: string) => {
  return getBuiltinIconDataUrl(key);
});

ipcMain.handle('icon:set', (_e, key: string) => {
  const builtin = getBuiltinIcons();
  if (!builtin[key]) {
    return { success: false, error: `Иконка "${key}" не найдена` };
  }
  const res = setWindowIcon(win, builtin[key]);
  if (res.success) setConfig('appIcon', key);
  return res;
});

ipcMain.handle('icon:setCustom', async () => {
  const pickRes = await pickCustomIcon();
  if (!pickRes.success || !pickRes.path) {
    return { success: false, error: pickRes.error || 'Не выбрано' };
  }
  const setRes = setWindowIcon(win, pickRes.path);
  if (setRes.success) setConfig('appIcon', 'custom');
  return { success: setRes.success, error: setRes.error };
});

ipcMain.handle('icon:getCustomPreview', () => {
  return getCustomIconDataUrl();
});

ipcMain.handle('icon:getBrandPreview', (_e, key: string, theme: string) => {
  // Keep renderer branding in sync with Settings > App icon, including custom PNGs.
  if (key === 'custom') {
    const custom = getCustomIconDataUrl();
    if (custom) return custom;
  } else if (key && getBuiltinIcons()[key]) {
    const selected = getBuiltinIconDataUrl(key);
    if (selected) return selected;
  }
  const themeKey = theme === 'light' || theme === 'forest' ? 'forest' : theme === 'grom' ? 'grom' : 'midnight';
  return getBuiltinIconDataUrl(themeKey) || getBuiltinIconDataUrl('grom');
});

ipcMain.handle('icon:reset', () => {
  clearCustomIcon();
  const cfg = getConfig();
  const themeIcon = getIconForTheme(cfg.theme);
  if (themeIcon) setWindowIcon(win, themeIcon);
  setConfig('appIcon', '');
  return { success: true };
});

// GPU PREFERENCE IPC
ipcMain.handle('gpu:status', () => {
  return getGpuStatus();
});

ipcMain.handle('gpu:setMode', async (_e, mode: GpuMode) => {
  try {
    const res = await applyGpuMode(mode);
    setConfig('gpuMode', mode);
    return { success: true, ...res };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gpu:applyDefault', async () => {
  try {
    await applyDefaultGpuPreferences();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const cfg = getConfig();
  if (cfg.gpuMode === 'high') {
    try {
      await applyDefaultGpuPreferences();
    } catch (err) {
      console.warn('[GPU] Ошибка автонастройки:', err);
    }
  }

  createWindow();
});

app.on('window-all-closed', () => {
  killTerminal();
  if (process.platform !== 'darwin') app.quit();
});