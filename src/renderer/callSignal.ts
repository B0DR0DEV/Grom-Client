import { supabase } from './supabaseClient';

/** Incoming call notifications go to a per-user "inbox" channel; the call itself uses its own room channel. */
export interface RingPayload { room: string; from: string; avatar: string | null; at: number }

/** STUN finds a direct route; TURN relays audio when both sides are behind strict NAT (common on mobile/home ISPs).
 *  Fill TURN_SERVERS with your own coturn (see relay/install-turn.sh). Without TURN some calls cannot connect. */
const TURN_SERVERS: RTCIceServer[] = [
  // { urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'], username: 'grom', credential: 'CHANGE_ME' },
];
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  ...TURN_SERVERS,
];
export const hasTurn = TURN_SERVERS.length > 0;

const inboxName = (nick: string) => `inbox:${nick.toLowerCase()}`;

export function newRoomId() {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sends one event to another user's inbox (joins briefly, sends, leaves). */
export async function sendToInbox(target: string, event: 'ring' | 'cancel' | 'decline' | 'busy', payload: Record<string, unknown>) {
  const ch = supabase.channel(inboxName(target), { config: { broadcast: { self: false, ack: true } } });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Нет связи с сервером звонков')), 8000);
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error('Нет связи с сервером звонков')); }
      });
    });
    await ch.send({ type: 'broadcast', event, payload });
  } finally {
    supabase.removeChannel(ch);
  }
}

/** Listens to my own inbox. Returns an unsubscribe function. */
export function listenInbox(me: string, handlers: { ring?: (p: RingPayload) => void; cancel?: (p: { room: string }) => void; decline?: (p: { room: string }) => void; busy?: (p: { room: string }) => void }) {
  const ch = supabase.channel(inboxName(me), { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'ring' }, (m: any) => handlers.ring?.(m.payload))
    .on('broadcast', { event: 'cancel' }, (m: any) => handlers.cancel?.(m.payload))
    .on('broadcast', { event: 'decline' }, (m: any) => handlers.decline?.(m.payload))
    .on('broadcast', { event: 'busy' }, (m: any) => handlers.busy?.(m.payload))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** Simple two-tone ringtone with WebAudio (no audio files needed). */
export function startRingtone(kind: 'incoming' | 'outgoing'): () => void {
  let ctx: AudioContext | null = null;
  try { ctx = new AudioContext(); } catch { return () => {}; }
  const c = ctx;
  const beep = (freq: number, at: number, dur: number) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.12, at + 0.02); g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(c.destination); o.start(at); o.stop(at + dur + 0.05);
  };
  const cycle = () => {
    const t = c.currentTime + 0.05;
    if (kind === 'incoming') { beep(880, t, 0.25); beep(660, t + 0.3, 0.25); beep(880, t + 0.6, 0.25); }
    else beep(425, t, 1.0);
  };
  cycle();
  const timer = setInterval(cycle, kind === 'incoming' ? 2000 : 4000);
  return () => { clearInterval(timer); c.close().catch(() => {}); };
}
