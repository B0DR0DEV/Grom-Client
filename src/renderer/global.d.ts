export {};

declare global {
  interface GromConfig {
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

  interface JavaInfo {
    found: boolean;
    path: string | null;
    version: string | null;
    majorVersion: number | null;
  }

  interface LaunchOptions {
    nickname: string;
    version: string;
    loader: string;
    ram: number;
    width: number;
    height: number;
    fullscreen: boolean;
    /** Selected instance: the game runs from its folder (mods/saves/config). */
    instance?: string;
    /** host[:port] to auto-join (1.20+: quick play). */
    server?: string;
  }

  interface LaunchResult { success: boolean; error?: string; }
  interface GameStatus { stage: 'installing' | 'running' | 'stopped'; message: string; progress?: number; }
  interface BackgroundItem { name: string; dataUrl: string; }
  interface CloudItem { name: string; dataUrl: string; }
  interface FontItem { name: string; dataUrl: string; }

  interface Instance {
    name: string;
    version: string;
    loader: string;
    modsCount: number;
    createdAt: string;
  }

  interface WorldInfo {
    name: string;
    path: string;
    sizeBytes: number;
    lastPlayed: string | null;
    icon: string | null;
  }

  interface ScreenshotInfo {
    name: string;
    dataUrl: string;
    date: string;
  }

  interface ModUpdate {
    fileName: string;
    projectId: string;
    projectName: string;
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
    newFileName: string;
  }

  interface AiPack {
    name: string;
    description: string;
    mods: string[];
  }

  interface LoaderInstallResult {
    success: boolean;
    versionId?: string;
    error?: string;
  }

  interface ModCompatibleVersions {
    gameVersions: string[];
    loaders: string[];
  }

  interface FpsMod {
    slug: string;
    name: string;
    description: string;
    required: boolean;
  }

  interface FpsDetect {
    totalRamMB: number;
    level: 'low' | 'mid' | 'high';
    recommendedRam: number;
  }

  interface FpsInstallResult {
    success: boolean;
    installed?: string[];
    failed?: { slug: string; error: string }[];
    error?: string;
  }

  interface GpuStatusItem { path: string; mode: 'auto' | 'high' | 'low' | null; }
  interface GpuStatus {
    java: GpuStatusItem[];
    launcher: GpuStatusItem;
  }

  interface ContentInstallResult {
    success: boolean;
    filename?: string;
    targetDir?: string;
    error?: string;
  }

  interface MinecraftNewsItem { id: string; title: string; date: string; category: string; text: string; url: string; image: string; }

  interface Window {
    grom: {
      version: string;
      author: string;
      windowControls: {
        minimize: () => Promise<boolean>;
        toggleMaximize: () => Promise<boolean>;
        close: () => Promise<boolean>;
        isMaximized: () => Promise<boolean>;
        onMaximized: (callback: (maximized: boolean) => void) => () => void;
      };

      pickFile: (type: 'skin' | 'cape') => Promise<string | null>;
      loadSavedFile: (type: 'skin' | 'cape') => Promise<string | null>;

      getConfig: () => Promise<GromConfig>;
      setConfig: (key: string, value: any) => Promise<boolean>;
      getGameDir: () => Promise<string>;

      getTotalRam: () => Promise<number>;
      getScreenSize: () => Promise<{ width: number; height: number }>;
      openFolder: (folder: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<boolean>;

      listBackgrounds: () => Promise<BackgroundItem[]>;
      listClouds: () => Promise<CloudItem[]>;
      pickFont: () => Promise<FontItem | null>;
      loadSavedFont: () => Promise<FontItem | null>;
      getButtonTexture: () => Promise<string | null>;
      getNavIcons: () => Promise<Record<string, string>>;

      getPetFrames: (petName: string) => Promise<string[]>;

      findJava: (minimumMajorVersion?: number) => Promise<JavaInfo>;
      getRequiredJava: (mcVersion: string) => Promise<number>;
      downloadJava: (mcVersion: string) => Promise<{ success: boolean; path?: string; error?: string }>;

      downloadElySkin: (nickname: string) => Promise<{ success: boolean; path?: string; url?: string; error?: string }>;
      saveSkinData: (dataUrl: string) => Promise<{ success: boolean; path?: string; dataUrl?: string; error?: string }>;
      applyMinecraftSkin: (variant: 'classic' | 'slim') => Promise<{ success: boolean; error?: string }>;
      microsoftLogin: () => Promise<{ success: boolean; profile?: { name: string; uuid: string; source: 'microsoft' }; error?: string }>;
      getMicrosoftAccount: () => Promise<{ name: string; uuid: string; source: 'microsoft' } | null>;
      microsoftLogout: () => Promise<{ success: boolean; error?: string }>;
      downloadElyCape: (nickname: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      getElySkinUrl: (nickname: string) => Promise<string>;

      getVersions: () => Promise<string[]>;
      getMinecraftNews: () => Promise<{ success: boolean; cached?: boolean; stale?: boolean; error?: string; items: MinecraftNewsItem[] }>;
      launch: (options: LaunchOptions) => Promise<LaunchResult>;
      installLoader: (loader: string, mcVersion: string) => Promise<LoaderInstallResult>;

      onGameStatus: (callback: (data: GameStatus) => void) => () => void;

      searchMods: (query: string, gameVersion: string, loader: string, projectType?: string) => Promise<any>;
      getPopularMods: (gameVersion: string, loader: string) => Promise<any>;
      getPopularByType: (gameVersion: string, loader: string, projectType: string) => Promise<any>;
      getModCompatibleVersions: (projectId: string) => Promise<ModCompatibleVersions | { error: string }>;
      downloadMod: (projectId: string, gameVersion: string, loader: string, instanceName: string) => Promise<{ success: boolean; filename?: string; error?: string }>;
      installByType: (projectId: string, gameVersion: string, loader: string, projectType: string, instanceName?: string) => Promise<ContentInstallResult>;
      openContentFolder: (projectType: string) => Promise<boolean>;
      importLocalMod: (filePath: string, instanceName?: string) => Promise<{ success: boolean; filename?: string; duplicate?: boolean; error?: string }>;
      maintenance: {
        stats: () => Promise<{ launches: number; totalDurationMs: number; recent: any[] }>;
        diagnose: () => Promise<{ found: boolean; file: string | null; modifiedAt: string | null; summary: string; findings: string[] }>;
        scanMods: (instanceName?: string) => Promise<any[]>;
        checkMinecraft: (version?: string) => Promise<{ ok: boolean; message: string; version?: string; results: { name: string; exists: boolean; isDirectory: boolean }[] }>;
        openLog: () => Promise<{ success: boolean; error?: string }>;
      };
      checkModUpdates: (instanceName: string, gameVersion: string, loader: string) => Promise<{ success: boolean; updates?: ModUpdate[]; error?: string }>;
      updateMod: (instanceName: string, oldFileName: string, downloadUrl: string, newFileName: string) => Promise<{ success: boolean; error?: string }>;

      searchModpacks: (query: string, gameVersion: string) => Promise<any>;
      downloadModpack: (projectId: string, gameVersion: string, instanceName: string) => Promise<{ success: boolean; filename?: string; error?: string }>;

      listInstances: () => Promise<Instance[]>;
      createInstance: (name: string, version: string, loader: string) => Promise<{ success: boolean; instance?: Instance; error?: string }>;
      deleteInstance: (name: string) => Promise<{ success: boolean; error?: string }>;
      exportMrpack: (instanceName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      importMrpack: () => Promise<{ success: boolean; instanceName?: string; error?: string }>;

      listWorlds: (instanceName?: string) => Promise<WorldInfo[]>;
      deleteWorld: (worldPath: string) => Promise<{ success: boolean; error?: string }>;
      backupWorld: (worldPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      listScreenshots: (instanceName?: string) => Promise<ScreenshotInfo[]>;

      generateModpack: (apiKey: string, prompt: string) => Promise<{ success: boolean; pack?: AiPack; error?: string }>;

      fps: {
        getMods: () => Promise<FpsMod[]>;
        detect: () => Promise<FpsDetect>;
        checkMods: () => Promise<Record<string, boolean>>;
        install: (version: string, loader: string, selectedSlugs: string[]) => Promise<FpsInstallResult>;
        uninstall: () => Promise<{ success: boolean; removed?: number; error?: string }>;
        openModsFolder: () => Promise<boolean>;
      };

      terminal: {
        spawn: () => Promise<{ success: boolean; error?: string }>;
        write: (data: string) => Promise<boolean>;
        kill: () => Promise<boolean>;
        isRunning: () => Promise<boolean>;
        onData: (callback: (data: string) => void) => () => void;
        onExit: (callback: (code: number) => void) => () => void;
      };

      icon: {
        list: () => Promise<Record<string, string>>;
        getBuiltinPreview: (key: string) => Promise<string | null>;
        set: (key: string) => Promise<{ success: boolean; error?: string }>;
        setCustom: () => Promise<{ success: boolean; error?: string }>;
        getCustomPreview: () => Promise<string | null>;
        getBrandPreview: (key: string, theme: string) => Promise<string | null>;
        reset: () => Promise<{ success: boolean }>;
      };

      stats: () => Promise<any>;
      share: {
        export: (instance: string) => Promise<{ success: boolean; error?: string; code?: string; mods?: number; unresolved?: number; name?: string; version?: string; loader?: string }>;
        preview: (code: string) => Promise<{ success: boolean; error?: string; name?: string; version?: string; loader?: string; mods?: number; unresolved?: number }>;
        import: (code: string, name?: string) => Promise<{ success: boolean; error?: string; name?: string; version?: string; loader?: string; installed?: number; failed?: string[]; unresolved?: number }>;
        onProgress: (cb: (d: { message: string; progress: number }) => void) => () => void;
      };
      importer: {
        detect: () => Promise<{ label: string; path: string }[]>;
        pick: () => Promise<string | null>;
        scan: (dir: string) => Promise<{ success: boolean; error?: string; path?: string; worlds?: number; candidates?: string[]; items?: { key: string; label: string; hint: string; files: number; bytes: number; byDefault: boolean }[] }>;
        run: (src: string, instance: string, keys: string[]) => Promise<{ success: boolean; error?: string; copied?: number; skipped?: number; backedUp?: number; failed?: number; backupDir?: string; dest?: string }>;
        onProgress: (cb: (p: { done: number; total: number; file: string }) => void) => () => void;
      };
      tunnel: {
        state: () => Promise<{ running: boolean; publicHost?: string; publicPort?: number; localPort?: number; error?: string }>;
        getRelay: () => Promise<{ host: string; port: number }>;
        setRelay: (host: string, port: number) => Promise<{ success: boolean }>;
        detectPort: () => Promise<number | null>;
        start: (localPort: number) => Promise<{ success: boolean; error?: string; running?: boolean; publicHost?: string; publicPort?: number }>;
        stop: () => Promise<{ success: boolean }>;
        onChanged: (cb: (s: { running: boolean; publicHost?: string; publicPort?: number; error?: string }) => void) => () => void;
      };

      gpu: {
        status: () => Promise<GpuStatus>;
        setMode: (mode: 'auto' | 'high' | 'low') => Promise<{ success: boolean; error?: string }>;
        applyDefault: () => Promise<{ success: boolean; error?: string }>;
      };
    };
  }
}