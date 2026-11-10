import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const GROM_DIR = path.join(os.homedir(), '.gromclient');
const LOCAL_USAGE_FILE = path.join(GROM_DIR, 'ai-usage.json');

const DAILY_LIMIT = 10;

export function getDeviceId(): string {
  try {
    const parts: string[] = [];

    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      const addrs = nets[name];
      if (!addrs) continue;
      for (const addr of addrs) {
        if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
          parts.push(addr.mac);
        }
      }
    }

    parts.push(os.userInfo().username);
    parts.push(os.hostname());
    parts.push(os.platform());
    parts.push(os.arch());

    const raw = parts.join('|');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return hash.substring(0, 32);
  } catch {
    return 'unknown-device';
  }
}

interface LocalUsage {
  date: string;
  count: number;
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function readLocalUsage(): LocalUsage {
  try {
    if (!fs.existsSync(LOCAL_USAGE_FILE)) return { date: getTodayDate(), count: 0 };
    const data = JSON.parse(fs.readFileSync(LOCAL_USAGE_FILE, 'utf-8'));
    if (data.date !== getTodayDate()) return { date: getTodayDate(), count: 0 };
    return data;
  } catch {
    return { date: getTodayDate(), count: 0 };
  }
}

function writeLocalUsage(usage: LocalUsage) {
  try {
    if (!fs.existsSync(GROM_DIR)) fs.mkdirSync(GROM_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch {}
}

let supabaseClient: any = null;

export function setSupabaseClient(client: any) {
  supabaseClient = client;
}

async function getRemoteUsage(deviceId: string): Promise<number | null> {
  if (!supabaseClient) return null;
  try {
    const today = getTodayDate();
    const { data, error } = await supabaseClient
      .from('ai_usage')
      .select('count')
      .eq('device_id', deviceId)
      .eq('date', today)
      .maybeSingle();

    if (error) return null;
    return data?.count ?? 0;
  } catch {
    return null;
  }
}

async function incrementRemoteUsage(deviceId: string): Promise<boolean> {
  if (!supabaseClient) return false;
  try {
    const today = getTodayDate();

    const { data: existing } = await supabaseClient
      .from('ai_usage')
      .select('count')
      .eq('device_id', deviceId)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseClient
        .from('ai_usage')
        .update({ count: (existing.count || 0) + 1 })
        .eq('device_id', deviceId)
        .eq('date', today);
      return !error;
    } else {
      const { error } = await supabaseClient
        .from('ai_usage')
        .insert({ device_id: deviceId, date: today, count: 1 });
      return !error;
    }
  } catch {
    return false;
  }
}

export interface UsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export async function getUsage(): Promise<UsageInfo> {
  const deviceId = getDeviceId();
  const today = getTodayDate();

  let used = await getRemoteUsage(deviceId);

  if (used === null) {
    used = readLocalUsage().count;
  } else {
    writeLocalUsage({ date: today, count: used });
  }

  const remaining = Math.max(0, DAILY_LIMIT - used);

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  return {
    used,
    limit: DAILY_LIMIT,
    remaining,
    resetAt: tomorrow.toISOString(),
  };
}

export async function canMakeRequest(): Promise<{ allowed: boolean; usage: UsageInfo }> {
  const usage = await getUsage();
  return { allowed: usage.remaining > 0, usage };
}

export async function incrementUsage(): Promise<void> {
  const deviceId = getDeviceId();
  const today = getTodayDate();

  const local = readLocalUsage();
  writeLocalUsage({ date: today, count: local.count + 1 });

  await incrementRemoteUsage(deviceId);
}

export function resetUsageLocal(): void {
  try {
    if (fs.existsSync(LOCAL_USAGE_FILE)) fs.unlinkSync(LOCAL_USAGE_FILE);
  } catch {}
}