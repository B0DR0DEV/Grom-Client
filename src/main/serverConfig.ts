import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const SERVER_DIR = path.join(GROM_DIR, 'server');

export interface ServerConfig {
  motd: string;
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator';
  pvp: boolean;
  onlineMode: boolean;
  maxPlayers: number;
  port: number;
  seed: string;
  viewDistance: number;
  simulationDistance: number;
  allowFlight: boolean;
  spawnAnimals: boolean;
  spawnMonsters: boolean;
  spawnNPCs: boolean;
  generateStructures: boolean;
  levelName: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  motd: 'Grom Client Server',
  difficulty: 'normal',
  gamemode: 'survival',
  pvp: true,
  onlineMode: false,
  maxPlayers: 10,
  port: 25565,
  seed: '',
  viewDistance: 10,
  simulationDistance: 10,
  allowFlight: false,
  spawnAnimals: true,
  spawnMonsters: true,
  spawnNPCs: true,
  generateStructures: true,
  levelName: 'world',
};

export function getServerConfig(): ServerConfig {
  const propsPath = path.join(SERVER_DIR, 'server.properties');
  if (!fs.existsSync(propsPath)) return DEFAULT_CONFIG;

  const content = fs.readFileSync(propsPath, 'utf-8');
  const lines = content.split('\n');
  const props: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    props[key] = rest.join('=');
  }

  return {
    motd: props['motd'] || DEFAULT_CONFIG.motd,
    difficulty: (props['difficulty'] as any) || DEFAULT_CONFIG.difficulty,
    gamemode: (props['gamemode'] as any) || DEFAULT_CONFIG.gamemode,
    pvp: props['pvp'] === 'true',
    onlineMode: props['online-mode'] === 'true',
    maxPlayers: parseInt(props['max-players']) || DEFAULT_CONFIG.maxPlayers,
    port: parseInt(props['server-port']) || DEFAULT_CONFIG.port,
    seed: props['level-seed'] || '',
    viewDistance: parseInt(props['view-distance']) || DEFAULT_CONFIG.viewDistance,
    simulationDistance: parseInt(props['simulation-distance']) || DEFAULT_CONFIG.simulationDistance,
    allowFlight: props['allow-flight'] === 'true',
    spawnAnimals: props['spawn-animals'] !== 'false',
    spawnMonsters: props['spawn-monsters'] !== 'false',
    spawnNPCs: props['spawn-npcs'] !== 'false',
    generateStructures: props['generate-structures'] !== 'false',
    levelName: props['level-name'] || 'world',
  };
}

export function saveServerConfig(config: ServerConfig): void {
  if (!fs.existsSync(SERVER_DIR)) fs.mkdirSync(SERVER_DIR, { recursive: true });

  const propsPath = path.join(SERVER_DIR, 'server.properties');

  let content = '';
  if (fs.existsSync(propsPath)) {
    content = fs.readFileSync(propsPath, 'utf-8');
  } else {
    content = `#Minecraft server properties\n`;
  }

  const updates: Record<string, string> = {
    'motd': config.motd,
    'difficulty': config.difficulty,
    'gamemode': config.gamemode,
    'pvp': String(config.pvp),
    'online-mode': String(config.onlineMode),
    'max-players': String(config.maxPlayers),
    'server-port': String(config.port),
    'level-seed': config.seed,
    'view-distance': String(config.viewDistance),
    'simulation-distance': String(config.simulationDistance),
    'allow-flight': String(config.allowFlight),
    'spawn-animals': String(config.spawnAnimals),
    'spawn-monsters': String(config.spawnMonsters),
    'spawn-npcs': String(config.spawnNPCs),
    'generate-structures': String(config.generateStructures),
    'level-name': config.levelName,
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(propsPath, content);
}

// Копирование модов из сборки в сервер
export function copyModsToServer(instancePath: string): number {
  const modsSrc = path.join(instancePath, 'mods');
  const modsDest = path.join(SERVER_DIR, 'mods');

  if (!fs.existsSync(modsSrc)) return 0;

  fs.mkdirSync(modsDest, { recursive: true });

  const files = fs.readdirSync(modsSrc).filter((f) => f.endsWith('.jar'));
  let copied = 0;

  for (const file of files) {
    fs.copyFileSync(path.join(modsSrc, file), path.join(modsDest, file));
    copied++;
  }

  // Также копируем config
  const configSrc = path.join(instancePath, 'config');
  const configDest = path.join(SERVER_DIR, 'config');
  if (fs.existsSync(configSrc)) {
    copyDirRecursive(configSrc, configDest);
  }

  return copied;
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}