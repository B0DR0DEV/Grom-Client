import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const AI_CONFIG = path.join(GROM_DIR, 'ai-config.json');

interface AIConfig {
  deepseekKey?: string;
}

function readConfig(): AIConfig {
  try {
    if (!fs.existsSync(AI_CONFIG)) return {};
    return JSON.parse(fs.readFileSync(AI_CONFIG, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config: AIConfig) {
  if (!fs.existsSync(GROM_DIR)) fs.mkdirSync(GROM_DIR, { recursive: true });
  fs.writeFileSync(AI_CONFIG, JSON.stringify(config, null, 2));
}

export function getAIKey(): string | null {
  const cfg = readConfig();
  return cfg.deepseekKey || null;
}

export function setAIKey(key: string): void {
  const cfg = readConfig();
  cfg.deepseekKey = key;
  writeConfig(cfg);
}