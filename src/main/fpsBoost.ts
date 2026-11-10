import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { searchMods, downloadMod } from './mods';

// ═══════════════════════════════════════════════════════
// СПИСОК МОДОВ ПРОИЗВОДИТЕЛЬНОСТИ
// ═══════════════════════════════════════════════════════
export interface FpsMod {
  slug: string;
  name: string;
  description: string;
  required: boolean;
}

export const FPS_MODS: FpsMod[] = [
  { slug: 'sodium', name: 'Sodium', description: 'Полная замена рендера — FPS x2-x3', required: true },
  { slug: 'lithium', name: 'Lithium', description: 'Оптимизация игровой логики и физики', required: true },
  { slug: 'starlight', name: 'Starlight', description: 'Ускорение загрузки чанков', required: true },
  { slug: 'krypton', name: 'Krypton', description: 'Ускорение сетевого стека', required: false },
  { slug: 'ferrite-core', name: 'FerriteCore', description: 'Экономия ОЗУ на моделях', required: false },
  { slug: 'entityculling', name: 'EntityCulling', description: 'Не рендерит невидимые сущности', required: false },
  { slug: 'modernfix', name: 'ModernFix', description: 'Ускорение запуска и экономия ОЗУ', required: false },
  { slug: 'indium', name: 'Indium', description: 'Совместимость Sodium с другими модами', required: false },
];

// ═══════════════════════════════════════════════════════
// AIKAR'S FLAGS
// Доказанно повышают FPS, рекомендованы Paper MC
// ═══════════════════════════════════════════════════════
export const AIKAR_FLAGS: string[] = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true',
];

/**
 * Возвращает JVM-аргументы Aikar's Flags с поправкой под ОЗУ.
 * Если ОЗУ ≤ 4 ГБ — убираем AlwaysPreTouch (он аллоцирует всю память сразу).
 */
export function getAikarFlags(ramMB: number): string[] {
  if (ramMB <= 4096) {
    return AIKAR_FLAGS.filter((f) => f !== '-XX:+AlwaysPreTouch');
  }
  return AIKAR_FLAGS;
}

// ═══════════════════════════════════════════════════════
// ОПРЕДЕЛЕНИЕ УРОВНЯ ПК
// ═══════════════════════════════════════════════════════
export type PCLevel = 'low' | 'mid' | 'high';

export function detectPCLevel(totalRamMB: number): PCLevel {
  if (totalRamMB >= 16384) return 'high';
  if (totalRamMB >= 8192) return 'mid';
  return 'low';
}

/**
 * Рекомендация по ОЗУ под уровень ПК.
 */
export function recommendRam(totalRamMB: number, level: PCLevel): number {
  if (level === 'high') return Math.min(8192, Math.floor(totalRamMB * 0.5));
  if (level === 'mid') return Math.min(4096, Math.floor(totalRamMB * 0.5));
  return Math.min(2048, Math.floor(totalRamMB * 0.5));
}

// ═══════════════════════════════════════════════════════
// ПРОВЕРКА УСТАНОВЛЕННЫХ МОДОВ
// ═══════════════════════════════════════════════════════
export function checkInstalledFpsMods(modsDir: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!fs.existsSync(modsDir)) {
    for (const m of FPS_MODS) result[m.slug] = false;
    return result;
  }

  const files = fs.readdirSync(modsDir).map((f) => f.toLowerCase());

  for (const mod of FPS_MODS) {
    const slugNormalized = mod.slug.replace(/-/g, '');
    const nameNormalized = mod.name.toLowerCase().replace(/-/g, '');

    const found = files.some((f) => {
      if (!f.endsWith('.jar')) return false;
      const clean = f.replace(/\.jar$/, '').replace(/-/g, '');
      return clean.includes(slugNormalized) || clean.includes(nameNormalized);
    });

    result[mod.slug] = found;
  }

  return result;
}

// ═══════════════════════════════════════════════════════
// УСТАНОВКА МОДОВ ЧЕРЕЗ MODRINTH
// ═══════════════════════════════════════════════════════
export async function installFpsMods(
  version: string,
  loader: string,
  modsDir: string,
  selectedSlugs: string[],
  onProgress: (msg: string, percent: number) => void
): Promise<{ installed: string[]; failed: { slug: string; error: string }[] }> {
  const installed: string[] = [];
  const failed: { slug: string; error: string }[] = [];

  if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true });
  }

  const modsToInstall = FPS_MODS.filter((m) => selectedSlugs.includes(m.slug));
  const total = modsToInstall.length;

  if (total === 0) return { installed, failed };

  const loaderForApi = loader === 'Vanilla' ? 'fabric' : loader.toLowerCase();

  for (let i = 0; i < total; i++) {
    const mod = modsToInstall[i];
    const percent = Math.round((i / total) * 100);
    onProgress(`Установка ${mod.name}...`, percent);

    try {
      // 1. Ищем мод на Modrinth
      const results = await searchMods(mod.slug, version, loaderForApi);
      if (!Array.isArray(results) || results.length === 0) {
        failed.push({ slug: mod.slug, error: 'Мод не найден на Modrinth' });
        continue;
      }

      // 2. Находим точное совпадение по slug
      const exact = results.find((r: any) => r.slug === mod.slug) || results[0];

      // 3. Удаляем старую версию мода, если есть
      const existingFiles = fs.readdirSync(modsDir);
      for (const file of existingFiles) {
        const lower = file.toLowerCase();
        if (!lower.endsWith('.jar')) continue;
        const clean = lower.replace(/\.jar$/, '').replace(/-/g, '');
        const slugClean = mod.slug.replace(/-/g, '');
        if (clean.includes(slugClean)) {
          try {
            fs.unlinkSync(path.join(modsDir, file));
          } catch {}
        }
      }

      // 4. Скачиваем через существующий модуль
      await downloadMod(exact.id, version, loaderForApi, modsDir);
      installed.push(mod.slug);
    } catch (err: any) {
      failed.push({ slug: mod.slug, error: err.message || 'Ошибка загрузки' });
    }
  }

  onProgress('Готово!', 100);
  return { installed, failed };
}

// ═══════════════════════════════════════════════════════
// УДАЛЕНИЕ ВСЕХ FPS-МОДОВ
// ═══════════════════════════════════════════════════════
export function uninstallFpsMods(modsDir: string): number {
  if (!fs.existsSync(modsDir)) return 0;

  let removed = 0;
  const files = fs.readdirSync(modsDir);

  for (const file of files) {
    const lower = file.toLowerCase();
    if (!lower.endsWith('.jar')) continue;

    const clean = lower.replace(/\.jar$/, '').replace(/-/g, '');
    const isFps = FPS_MODS.some((mod) => {
      const slugClean = mod.slug.replace(/-/g, '');
      const nameClean = mod.name.toLowerCase().replace(/-/g, '');
      return clean.includes(slugClean) || clean.includes(nameClean);
    });

    if (isFps) {
      try {
        fs.unlinkSync(path.join(modsDir, file));
        removed++;
      } catch {}
    }
  }

  return removed;
}