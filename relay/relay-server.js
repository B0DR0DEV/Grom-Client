#!/usr/bin/env node
// Grom relay — shared by every launcher user, isolated per user. No dependencies.
//
// HOSTNAME MODE (recommended for a public service): set PUBLIC_DOMAIN=play.example.com and a wildcard DNS
//   record  *.play.example.com -> this server. Every user gets a private, unguessable address
//   <random>.play.example.com on ONE public port (25565). Only valid Minecraft handshakes are forwarded,
//   so the relay cannot be abused as a generic proxy.
// PORT MODE (no domain): each user gets a random port from PORT_MIN..PORT_MAX.
//
//   node relay-server.js        env: CONTROL_PORT PUBLIC_DOMAIN PUBLIC_PORT PORT_MIN PORT_MAX
//                                    MAX_ROOMS MAX_ROOMS_PER_IP MAX_CONN_PER_ROOM MAX_CONN_PER_IP_ROOM
const net = require('net');
const crypto = require('crypto');

const num = (k, d) => Number(process.env[k]) || d;
const CONTROL_PORT = num('CONTROL_PORT', 7000);
const DOMAIN = (process.env.PUBLIC_DOMAIN || '').toLowerCase().replace(/^\.+|\.+$/g, '');
const PUBLIC_PORT = num('PUBLIC_PORT', 25565);
const PORT_MIN = num('PORT_MIN', 25600), PORT_MAX = num('PORT_MAX', 25699);
const MAX_ROOMS = num('MAX_ROOMS', 5000), MAX_ROOMS_PER_IP = num('MAX_ROOMS_PER_IP', 3);
const MAX_CONN_PER_ROOM = num('MAX_CONN_PER_ROOM', 20), MAX_CONN_PER_IP_ROOM = num('MAX_CONN_PER_IP_ROOM', 6);
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const rooms = new Map();      // code (hostname mode) or port (port mode) -> room
const byInstall = new Map();  // installId -> room (one active room per install)
const pending = new Map();    // conn id -> { sock, timer, room, initial }
const hostAttempts = new Map(); // ip -> [timestamps]
const ip = (s) => (s.remoteAddress || '').replace('::ffff:', '');

function tooManyAttempts(addr) {
  const now = Date.now(); const list = (hostAttempts.get(addr) || []).filter((t) => now - t < 60000);
  list.push(now); hostAttempts.set(addr, list); return list.length > 10;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hostAttempts) if (!v.some((t) => now - t < 60000)) hostAttempts.delete(k); }, 60000).unref();

function newCode() {
  for (;;) {
    const b = crypto.randomBytes(10); let c = '';
    for (const x of b) c += CODE_ALPHABET[x % CODE_ALPHABET.length];
    if (!rooms.has(c)) return c;
  }
}

function closeRoom(room) {
  if (room.closed) return; room.closed = true;
  rooms.delete(room.key); if (byInstall.get(room.installId) === room) byInstall.delete(room.installId);
  if (room.server) room.server.close();
  room.players.forEach((s) => s.destroy()); room.ctrl.destroy();
  for (const [id, p] of pending) if (p.room === room) { clearTimeout(p.timer); p.sock.destroy(); pending.delete(id); }
}

function readLine(sock, cb) {
  let buf = Buffer.alloc(0);
  const timer = setTimeout(() => sock.destroy(), 5000);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const i = buf.indexOf(10);
    if (i < 0) { if (buf.length > 256) sock.destroy(); return; }
    sock.removeListener('data', onData); clearTimeout(timer);
    cb(buf.slice(0, i).toString().trim(), buf.slice(i + 1));
  };
  sock.on('data', onData);
}

// ── Minecraft handshake parsing (hostname routing) ──
function varInt(buf, off) {
  let n = 0, shift = 0;
  for (let i = 0; i < 5; i++) {
    if (off + i >= buf.length) return null;
    const b = buf[off + i]; n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: n, size: i + 1 };
    shift += 7;
  }
  return { value: -1, size: 5 };
}
/** Returns the host the client typed, null if more bytes are needed, false if not a valid handshake. */
function parseHandshakeHost(buf) {
  const len = varInt(buf, 0); if (!len) return null;
  if (len.value < 3 || len.value > 1024) return false;
  if (buf.length < len.size + len.value) return null;
  let o = len.size;
  const id = varInt(buf, o); if (!id || id.value !== 0) return false; o += id.size;
  const proto = varInt(buf, o); if (!proto) return false; o += proto.size;
  const hl = varInt(buf, o); if (!hl || hl.value < 1 || hl.value > 255) return false; o += hl.size;
  if (o + hl.value > buf.length) return false;
  return buf.slice(o, o + hl.value).toString('utf8').split('\0')[0].toLowerCase().replace(/\.$/, '');
}

function attachPlayer(room, player, initial) {
  if (room.closed) return player.destroy();
  const addr = ip(player);
  const same = [...room.players].filter((p) => ip(p) === addr).length;
  if (room.players.size >= MAX_CONN_PER_ROOM || same >= MAX_CONN_PER_IP_ROOM) return player.destroy();
  const id = crypto.randomBytes(8).toString('hex');
  player.pause(); room.players.add(player);
  player.on('close', () => room.players.delete(player));
  const timer = setTimeout(() => { pending.delete(id); player.destroy(); }, 10000);
  pending.set(id, { sock: player, timer, room, initial: initial || Buffer.alloc(0) });
  room.ctrl.write(`CONN ${id}\n`);
}

function onPublicHostnameConn(player) {
  player.on('error', () => {});
  let buf = Buffer.alloc(0);
  const timer = setTimeout(() => player.destroy(), 5000);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 2048) { clearTimeout(timer); return player.destroy(); }
    const host = parseHandshakeHost(buf);
    if (host === null) return;
    player.removeListener('data', onData); clearTimeout(timer);
    if (host === false || !host.endsWith('.' + DOMAIN)) return player.destroy();
    const code = host.slice(0, -DOMAIN.length - 1).split('.').pop();
    const room = rooms.get(code);
    if (!room) return player.destroy();
    attachPlayer(room, player, buf);
  };
  player.on('data', onData);
}

net.createServer((sock) => {
  sock.on('error', () => {});
  readLine(sock, (line, rest) => {
    const [cmd, arg] = line.split(' ');
    if (cmd === 'HOST') {
      const addr = ip(sock);
      if (tooManyAttempts(addr)) return sock.end('ERR rate_limited\n');
      if (!/^[a-f0-9]{32}$/.test(arg || '')) return sock.end('ERR bad_id\n');
      if (rooms.size >= MAX_ROOMS) return sock.end('ERR full\n');
      const old = byInstall.get(arg); if (old) closeRoom(old);
      if ([...rooms.values()].filter((r) => r.ownerIp === addr).length >= MAX_ROOMS_PER_IP) return sock.end('ERR too_many_rooms\n');

      const start = (room, reply) => {
        rooms.set(room.key, room); byInstall.set(arg, room);
        let idle = setTimeout(() => sock.destroy(), 60000);
        sock.on('data', () => { clearTimeout(idle); idle = setTimeout(() => sock.destroy(), 60000); });
        sock.on('close', () => { clearTimeout(idle); closeRoom(room); });
        sock.write(reply);
      };
      const base = { ctrl: sock, players: new Set(), ownerIp: addr, installId: arg, closed: false };
      if (DOMAIN) {
        const code = newCode();
        return start({ ...base, key: code, server: null }, `OK ${PUBLIC_PORT} ${code}.${DOMAIN}\n`);
      }
      const free = []; for (let p = PORT_MIN; p <= PORT_MAX; p++) if (!rooms.has(p)) free.push(p);
      (function next() {
        if (!free.length) return sock.end('ERR full\n');
        const port = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        const server = net.createServer(); server.once('error', next);
        server.listen(port, '0.0.0.0', () => {
          const room = { ...base, key: port, server };
          server.on('connection', (player) => { player.on('error', () => {}); attachPlayer(room, player); });
          start(room, `OK ${port}\n`);
        });
      })();
    } else if (cmd === 'DATA') {
      const p = pending.get(arg);
      if (!p) return sock.destroy();
      pending.delete(arg); clearTimeout(p.timer);
      if (p.initial.length) sock.write(p.initial);
      if (rest.length) p.sock.write(rest);
      sock.pipe(p.sock); p.sock.pipe(sock);
      sock.on('close', () => p.sock.destroy()); p.sock.on('close', () => sock.destroy());
      p.sock.resume();
    } else sock.destroy();
  });
}).listen(CONTROL_PORT, '0.0.0.0', () => console.log(`Grom relay: control ${CONTROL_PORT}, ${DOMAIN ? `hostname mode *.${DOMAIN}:${PUBLIC_PORT}` : `port mode ${PORT_MIN}-${PORT_MAX}`}`));

if (DOMAIN) net.createServer(onPublicHostnameConn).listen(PUBLIC_PORT, '0.0.0.0');
