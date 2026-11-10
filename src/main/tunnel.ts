import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CFG = path.join(os.homedir(), '.gromclient', 'relay.json');
const ID_FILE = path.join(os.homedir(), '.gromclient', 'install-id');
/** Address of the relay that ships with the launcher (control address, e.g. 'relay.example.com').
 *  >>> SET THIS to your own relay before publishing the build — users then get tunnels with zero setup. */
export const DEFAULT_RELAY: RelayConfig = { host: process.env.GROM_RELAY_HOST || '', port: Number(process.env.GROM_RELAY_PORT) || 7000 };

/** Random per-install identity: gives every user their own isolated room on the shared relay. */
function installId(): string {
  try { const v = fs.readFileSync(ID_FILE, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(v)) return v; } catch {}
  const v = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(ID_FILE), { recursive: true }); fs.writeFileSync(ID_FILE, v);
  return v;
}
export interface RelayConfig { host: string; port: number }
export interface TunnelState { running: boolean; publicHost?: string; publicPort?: number; localPort?: number; error?: string }

export function getRelay(): RelayConfig {
  try { const x = JSON.parse(fs.readFileSync(CFG, 'utf8')); if (x.host) return { host: String(x.host), port: Number(x.port) || 7000 }; } catch {}
  return DEFAULT_RELAY;
}
export function setRelay(cfg: RelayConfig) {
  fs.mkdirSync(path.dirname(CFG), { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify({ host: cfg.host.trim(), port: cfg.port || 7000 }, null, 2));
}

/** Reads the port Minecraft printed after "Open to LAN" from latest.log. */
export function detectLanPort(gameDir: string): number | null {
  try {
    const log = fs.readFileSync(path.join(gameDir, 'logs', 'latest.log'), 'utf8').slice(-400_000);
    const all = [...log.matchAll(/(?:hosted on port|на порт[еу]?)\s*(\d{4,5})/gi)];
    return all.length ? Number(all[all.length - 1][1]) : null;
  } catch { return null; }
}

let ctrl: net.Socket | null = null;
let ping: ReturnType<typeof setInterval> | null = null;
const live = new Set<net.Socket>();
let state: TunnelState = { running: false };

const ERR_TEXT: Record<string, string> = { rate_limited: 'Слишком много попыток, подожди минуту', too_many_rooms: 'С этого IP уже открыто максимум туннелей', full: 'Сервер relay переполнен, попробуй позже', bad_id: 'Ошибка идентификатора установки' };
export const getTunnelState = () => state;

export function stopTunnel() {
  if (ping) clearInterval(ping);
  ping = null;
  ctrl?.destroy(); ctrl = null;
  live.forEach((s) => s.destroy()); live.clear();
  state = { running: false };
}

export function startTunnel(localPort: number, onChange: (s: TunnelState) => void): Promise<TunnelState> {
  stopTunnel();
  const relay = getRelay();
  if (!relay.host) return Promise.reject(new Error('Relay-сервер не указан. Введи адрес в блоке «Туннель».'));
  if (!(localPort > 0 && localPort < 65536)) return Promise.reject(new Error('Некорректный порт LAN'));

  return new Promise((resolve, reject) => {
    const c = net.connect(relay.port, relay.host);
    ctrl = c;
    let buf = '';
    let ready = false;
    const fail = (msg: string) => { if (!ready) { stopTunnel(); reject(new Error(msg)); } else { stopTunnel(); onChange({ running: false, error: msg }); } };
    c.setTimeout(8000, () => { if (!ready) fail('Relay не отвечает'); });
    c.on('error', (e) => fail(`Relay: ${e.message}`));
    c.on('close', () => { if (ctrl === c) fail('Соединение с relay потеряно'); });
    c.write(`HOST ${installId()}\n`);
    c.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const [cmd, arg, arg2] = line.split(' ');
        if (cmd === 'OK' && !ready) {
          ready = true; c.setTimeout(0);
          state = { running: true, publicHost: arg2 || relay.host, publicPort: Number(arg), localPort };
          ping = setInterval(() => c.write('PING\n'), 20000);
          onChange(state); resolve(state);
        } else if (cmd === 'ERR' && !ready) {
          fail(ERR_TEXT[arg || ''] || `Relay: ${arg || 'отказ'}`);
        } else if (cmd === 'CONN' && arg) {
          const data = net.connect(relay.port, relay.host);
          const local = net.connect(localPort, '127.0.0.1');
          live.add(data); live.add(local);
          const drop = () => { data.destroy(); local.destroy(); live.delete(data); live.delete(local); };
          data.on('error', drop); local.on('error', drop); data.on('close', drop); local.on('close', drop);
          local.once('connect', () => { data.write(`DATA ${arg}\n`); data.pipe(local); local.pipe(data); });
        }
      }
    });
  });
}
