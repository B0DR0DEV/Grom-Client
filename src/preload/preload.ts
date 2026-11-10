import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('grom', {
  version: '1.5.3',
  author: 'B0DR0DEV',

  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },

  pickFile: (type: 'skin' | 'cape') => ipcRenderer.invoke('pick-file', type),
  loadSavedFile: (type: 'skin' | 'cape') => ipcRenderer.invoke('load-saved-file', type),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  getGameDir: () => ipcRenderer.invoke('config:getGameDir'),

  getTotalRam: () => ipcRenderer.invoke('system:getTotalRam'),
  getScreenSize: () => ipcRenderer.invoke('system:getScreenSize'),
  openFolder: (folder: string) => ipcRenderer.invoke('system:openFolder', folder),
  openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url),

  listBackgrounds: () => ipcRenderer.invoke('backgrounds:list'),
  listClouds: () => ipcRenderer.invoke('clouds:list'),
  pickFont: () => ipcRenderer.invoke('fonts:pick'),
  loadSavedFont: () => ipcRenderer.invoke('fonts:loadSaved'),
  getButtonTexture: () => ipcRenderer.invoke('ui:getButtonTexture'),
  getNavIcons: () => ipcRenderer.invoke('ui:getNavIcons'),

  getPetFrames: (petName: string) => ipcRenderer.invoke('pets:getFrames', petName),

  findJava: (minimumMajorVersion?: number) => ipcRenderer.invoke('java:find', minimumMajorVersion),
  getRequiredJava: (mcVersion: string) => ipcRenderer.invoke('java:getRequired', mcVersion),
  downloadJava: (mcVersion: string) => ipcRenderer.invoke('java:download', mcVersion),

  downloadElySkin: (nickname: string) => ipcRenderer.invoke('ely:downloadSkin', nickname),
  saveSkinData: (dataUrl: string) => ipcRenderer.invoke('skin:saveData', dataUrl),
  applyMinecraftSkin: (variant: 'classic' | 'slim') => ipcRenderer.invoke('skin:applyMicrosoft', variant),
  microsoftLogin: () => ipcRenderer.invoke('microsoft:login'),
  getMicrosoftAccount: () => ipcRenderer.invoke('microsoft:account'),
  microsoftLogout: () => ipcRenderer.invoke('microsoft:logout'),
  downloadElyCape: (nickname: string) => ipcRenderer.invoke('ely:downloadCape', nickname),
  getElySkinUrl: (nickname: string) => ipcRenderer.invoke('ely:getSkinUrl', nickname),

  getVersions: () => ipcRenderer.invoke('minecraft:getVersions'),
  getMinecraftNews: () => ipcRenderer.invoke('news:minecraft'),
  launch: (options: any) => ipcRenderer.invoke('minecraft:launch', options),
  installLoader: (loader: string, mcVersion: string) => ipcRenderer.invoke('loader:install', loader, mcVersion),

  onGameStatus: (callback: (data: any) => void) => {
    const listener = (_e: any, data: any) => callback(data);
    ipcRenderer.on('minecraft:status', listener);
    return () => ipcRenderer.removeListener('minecraft:status', listener);
  },

  searchMods: (query: string, gameVersion: string, loader: string, projectType?: string) =>
    ipcRenderer.invoke('mods:search', query, gameVersion, loader, projectType),
  getPopularMods: (gameVersion: string, loader: string) =>
    ipcRenderer.invoke('mods:getPopular', gameVersion, loader),
  getPopularByType: (gameVersion: string, loader: string, projectType: string) =>
    ipcRenderer.invoke('mods:getPopularByType', gameVersion, loader, projectType),
  getModCompatibleVersions: (projectId: string) =>
    ipcRenderer.invoke('mods:getCompatibleVersions', projectId),
  downloadMod: (projectId: string, gameVersion: string, loader: string, instanceName: string) =>
    ipcRenderer.invoke('mods:download', projectId, gameVersion, loader, instanceName),
  installByType: (projectId: string, gameVersion: string, loader: string, projectType: string, instanceName?: string) =>
    ipcRenderer.invoke('mods:installByType', projectId, gameVersion, loader, projectType, instanceName),
  openContentFolder: (projectType: string) =>
    ipcRenderer.invoke('mods:openContentFolder', projectType),
  importLocalMod: (filePath: string, instanceName?: string) => ipcRenderer.invoke('mods:importLocal', filePath, instanceName),
  maintenance: {
    stats: () => ipcRenderer.invoke('maintenance:stats'),
    diagnose: () => ipcRenderer.invoke('maintenance:diagnose'),
    scanMods: (instanceName?: string) => ipcRenderer.invoke('maintenance:scanMods', instanceName),
    checkMinecraft: (version?: string) => ipcRenderer.invoke('maintenance:checkMinecraft', version),
    openLog: () => ipcRenderer.invoke('maintenance:openLog'),
  },
  checkModUpdates: (instanceName: string, gameVersion: string, loader: string) =>
    ipcRenderer.invoke('mods:checkUpdates', instanceName, gameVersion, loader),
  updateMod: (instanceName: string, oldFileName: string, downloadUrl: string, newFileName: string) =>
    ipcRenderer.invoke('mods:update', instanceName, oldFileName, downloadUrl, newFileName),

  searchModpacks: (query: string, gameVersion: string) => ipcRenderer.invoke('modpacks:search', query, gameVersion),
  downloadModpack: (projectId: string, gameVersion: string, instanceName: string) =>
    ipcRenderer.invoke('modpacks:download', projectId, gameVersion, instanceName),

  listInstances: () => ipcRenderer.invoke('instances:list'),
  createInstance: (name: string, version: string, loader: string) =>
    ipcRenderer.invoke('instances:create', name, version, loader),
  deleteInstance: (name: string) => ipcRenderer.invoke('instances:delete', name),
  exportMrpack: (instanceName: string) => ipcRenderer.invoke('instances:exportMrpack', instanceName),
  importMrpack: () => ipcRenderer.invoke('instances:importMrpack'),

  listWorlds: (instanceName?: string) => ipcRenderer.invoke('worlds:list', instanceName),
  deleteWorld: (worldPath: string) => ipcRenderer.invoke('worlds:delete', worldPath),
  backupWorld: (worldPath: string) => ipcRenderer.invoke('worlds:backup', worldPath),
  listScreenshots: (instanceName?: string) => ipcRenderer.invoke('screenshots:list', instanceName),

  generateModpack: (apiKey: string, prompt: string) =>
    ipcRenderer.invoke('ai:generateModpack', apiKey, prompt),

  fps: {
    getMods: () => ipcRenderer.invoke('fps:getMods'),
    detect: () => ipcRenderer.invoke('fps:detect'),
    checkMods: () => ipcRenderer.invoke('fps:checkMods'),
    install: (version: string, loader: string, selectedSlugs: string[]) =>
      ipcRenderer.invoke('fps:install', version, loader, selectedSlugs),
    uninstall: () => ipcRenderer.invoke('fps:uninstall'),
    openModsFolder: () => ipcRenderer.invoke('fps:openModsFolder'),
  },

  terminal: {
    spawn: () => ipcRenderer.invoke('terminal:spawn'),
    write: (data: string) => ipcRenderer.invoke('terminal:write', data),
    kill: () => ipcRenderer.invoke('terminal:kill'),
    isRunning: () => ipcRenderer.invoke('terminal:isRunning'),
    onData: (callback: (data: string) => void) => {
      const listener = (_e: any, data: string) => callback(data);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (callback: (code: number) => void) => {
      const listener = (_e: any, code: number) => callback(code);
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },

  icon: {
    list: () => ipcRenderer.invoke('icon:list'),
    getBuiltinPreview: (key: string) => ipcRenderer.invoke('icon:getBuiltinPreview', key),
    set: (key: string) => ipcRenderer.invoke('icon:set', key),
    setCustom: () => ipcRenderer.invoke('icon:setCustom'),
    getCustomPreview: () => ipcRenderer.invoke('icon:getCustomPreview'),
    getBrandPreview: (key: string, theme: string) => ipcRenderer.invoke('icon:getBrandPreview', key, theme),
    reset: () => ipcRenderer.invoke('icon:reset'),
  },

  stats: () => ipcRenderer.invoke('maintenance:stats'),
  share: {
    export: (instance: string) => ipcRenderer.invoke('share:export', instance),
    preview: (code: string) => ipcRenderer.invoke('share:preview', code),
    import: (code: string, name?: string) => ipcRenderer.invoke('share:import', code, name),
    onProgress: (cb: (d: { message: string; progress: number }) => void) => {
      const l = (_e: any, d: any) => cb(d); ipcRenderer.on('share:progress', l); return () => ipcRenderer.removeListener('share:progress', l);
    },
  },
  importer: {
    detect: () => ipcRenderer.invoke('import:detect'),
    pick: () => ipcRenderer.invoke('import:pick'),
    scan: (dir: string) => ipcRenderer.invoke('import:scan', dir),
    run: (src: string, instance: string, keys: string[]) => ipcRenderer.invoke('import:run', src, instance, keys),
    onProgress: (cb: (p: { done: number; total: number; file: string }) => void) => {
      const l = (_e: any, d: any) => cb(d); ipcRenderer.on('import:progress', l); return () => ipcRenderer.removeListener('import:progress', l);
    },
  },
  tunnel: {
    state: () => ipcRenderer.invoke('tunnel:state'),
    getRelay: () => ipcRenderer.invoke('tunnel:getRelay'),
    setRelay: (host: string, port: number) => ipcRenderer.invoke('tunnel:setRelay', host, port),
    detectPort: () => ipcRenderer.invoke('tunnel:detectPort'),
    start: (localPort: number) => ipcRenderer.invoke('tunnel:start', localPort),
    stop: () => ipcRenderer.invoke('tunnel:stop'),
    onChanged: (cb: (s: any) => void) => {
      const l = (_e: any, d: any) => cb(d); ipcRenderer.on('tunnel:changed', l); return () => ipcRenderer.removeListener('tunnel:changed', l);
    },
  },

  gpu: {
    status: () => ipcRenderer.invoke('gpu:status'),
    setMode: (mode: 'auto' | 'high' | 'low') => ipcRenderer.invoke('gpu:setMode', mode),
    applyDefault: () => ipcRenderer.invoke('gpu:applyDefault'),
  },
});