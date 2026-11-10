import { Conf } from 'electron-conf/main';

export interface GromConfig {
  nickname: string;
  accountType: 'offline' | 'microsoft';
  gameDir: string;
  version: string;
  loader: string;
  ram: number;
  width: number;
  height: number;
  fullscreen: boolean;
  language: 'ru' | 'en';
  hideLauncherOnStart: boolean;
  skinPath: string | null;
  capePath: string | null;
  theme: 'grom' | 'forest' | 'light' | 'midnight';
  background: string;
  panelOpacity: number;
  blurAmount: number;
  customFontPath: string | null;
  customFontName: string | null;
  petEnabled: boolean;
  petType: string;
  fpsBoostEnabled: boolean;
  fpsBoostAikar: boolean;
  fpsBoostMods: boolean;
  fpsBoostAutoRam: boolean;
  appIcon: string;
  gpuMode: 'auto' | 'high' | 'low';
}

const defaults: GromConfig = {
  nickname: 'Player',
  accountType: 'offline',
  gameDir: '',
  version: '',
  loader: 'Vanilla',
  ram: 2048,
  width: 1280,
  height: 720,
  fullscreen: false,
  language: 'ru',
  hideLauncherOnStart: false,
  skinPath: null,
  capePath: null,
  theme: 'midnight',
  background: 'none',
  panelOpacity: 85,
  blurAmount: 12,
  customFontPath: null,
  customFontName: null,
  petEnabled: true,
  petType: 'bee',
  fpsBoostEnabled: false,
  fpsBoostAikar: true,
  fpsBoostMods: true,
  fpsBoostAutoRam: true,
  appIcon: '',
  gpuMode: 'high',
};

export const store = new Conf<GromConfig>({
  name: 'grom-config',
  defaults,
});

// One-time visual refresh migration: old installs defaulted to the green Forest theme.
// Move that old default to the new dark violet look once, while keeping future user choices.
const migrationStore = store as any;
if (!migrationStore.get('grom132ThemeMigrated')) {
  if (store.get('theme') === 'forest') store.set('theme', 'midnight');
  migrationStore.set('grom132ThemeMigrated', true);
}

export function getConfig(): GromConfig {
  return {
    nickname: store.get('nickname'),
    accountType: store.get('accountType') || 'offline',
    gameDir: store.get('gameDir'),
    version: store.get('version'),
    loader: store.get('loader'),
    ram: store.get('ram'),
    width: store.get('width'),
    height: store.get('height'),
    fullscreen: store.get('fullscreen'),
    language: store.get('language'),
    hideLauncherOnStart: store.get('hideLauncherOnStart'),
    skinPath: store.get('skinPath'),
    capePath: store.get('capePath'),
    theme: store.get('theme'),
    background: store.get('background'),
    panelOpacity: store.get('panelOpacity'),
    blurAmount: store.get('blurAmount'),
    customFontPath: store.get('customFontPath'),
    customFontName: store.get('customFontName'),
    petEnabled: store.get('petEnabled'),
    petType: store.get('petType'),
    fpsBoostEnabled: store.get('fpsBoostEnabled'),
    fpsBoostAikar: store.get('fpsBoostAikar'),
    fpsBoostMods: store.get('fpsBoostMods'),
    fpsBoostAutoRam: store.get('fpsBoostAutoRam'),
    appIcon: store.get('appIcon'),
    gpuMode: store.get('gpuMode'),
  };
}

export function setConfig<K extends keyof GromConfig>(key: K, value: GromConfig[K]) {
  store.set(key, value);
}