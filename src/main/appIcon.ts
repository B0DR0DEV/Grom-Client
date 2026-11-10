import { app, BrowserWindow, nativeImage, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const CUSTOM_ICON_PATH = path.join(GROM_DIR, 'custom-icon.png');

function getAssetsDir(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, '../../assets');
  }
  return path.join(process.resourcesPath, 'assets');
}

// Возвращает карту { forest: '/полный/путь/icon-forest.png', ... }
export function getBuiltinIcons(): Record<string, string> {
  const iconsDir = path.join(getAssetsDir(), 'icons');
  const result: Record<string, string> = {};

  const names = ['forest', 'grom', 'midnight'];
  for (const name of names) {
    const p = path.join(iconsDir, `icon-${name}.png`);
    if (fs.existsSync(p)) {
      result[name] = p;
    }
  }
  return result;
}

// Получить PNG для темы
export function getIconForTheme(theme: string): string | null {
  const icons = getBuiltinIcons();
  if (theme === 'light') return icons['forest'] || null;
  return icons[theme] || null;
}

// Прочитать PNG как data URL (для превью в renderer)
export function getBuiltinIconDataUrl(key: string): string | null {
  const icons = getBuiltinIcons();
  const p = icons[key];
  if (!p || !fs.existsSync(p)) return null;
  try {
    const buffer = fs.readFileSync(p);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// Установить иконку окна
export function setWindowIcon(
  win: BrowserWindow | null,
  pngPath: string | null
): { success: boolean; error?: string } {
  if (!win) return { success: false, error: 'Окно не найдено' };
  if (!pngPath) return { success: false, error: 'Путь к иконке не задан' };
  if (!fs.existsSync(pngPath)) return { success: false, error: 'Файл иконки не найден' };

  try {
    const img = nativeImage.createFromPath(pngPath);
    if (img.isEmpty()) {
      return { success: false, error: 'Не удалось загрузить PNG' };
    }
    win.setIcon(img);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Диалог выбора PNG от юзера
export async function pickCustomIcon(): Promise<{ success: boolean; path?: string; error?: string }> {
  const result = await dialog.showOpenDialog({
    title: 'Выбери иконку (PNG)',
    filters: [{ name: 'PNG', extensions: ['png'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Отменено' };
  }

  const srcPath = result.filePaths[0];
  const stats = fs.statSync(srcPath);
  if (stats.size > 5 * 1024 * 1024) {
    return { success: false, error: 'Файл слишком большой (макс. 5 МБ)' };
  }

  try {
    if (!fs.existsSync(GROM_DIR)) fs.mkdirSync(GROM_DIR, { recursive: true });
    fs.copyFileSync(srcPath, CUSTOM_ICON_PATH);
    return { success: true, path: CUSTOM_ICON_PATH };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Путь к пользовательской иконке
export function getCustomIconPath(): string | null {
  if (fs.existsSync(CUSTOM_ICON_PATH)) return CUSTOM_ICON_PATH;
  return null;
}

// Data URL пользовательской иконки
export function getCustomIconDataUrl(): string | null {
  const p = getCustomIconPath();
  if (!p) return null;
  try {
    const buffer = fs.readFileSync(p);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// Удалить пользовательскую иконку
export function clearCustomIcon(): void {
  if (fs.existsSync(CUSTOM_ICON_PATH)) {
    try { fs.unlinkSync(CUSTOM_ICON_PATH); } catch {}
  }
}