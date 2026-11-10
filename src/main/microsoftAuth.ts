import { app, safeStorage } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { MicrosoftAuthenticator } from '@xmcl/user';

/**
 * Microsoft desktop OAuth configuration.
 * Register a public client for personal Microsoft accounts and add `http://localhost`
 * under Mobile and desktop applications. A desktop client must never have a client secret.
 * The ID is public, but must belong to the app publisher; don't borrow another launcher's ID.
 */
const MICROSOFT_CLIENT_ID = process.env.GROM_MICROSOFT_CLIENT_ID || 'PASTE_YOUR_MICROSOFT_CLIENT_ID_HERE';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const AUTHORIZE_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MINECRAFT_PROFILE_ENDPOINT = 'https://api.minecraftservices.com/minecraft/profile';
const SESSION_FILE = path.join(app.getPath('userData'), 'microsoft-session.bin');

export interface MinecraftProfileSummary {
  name: string;
  uuid: string;
  source: 'microsoft';
}

export interface MinecraftLaunchSession extends MinecraftProfileSummary {
  accessToken: string;
}

interface StoredSession {
  refreshToken: string;
  profile: MinecraftProfileSummary;
  savedAt: number;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function ensureConfigured(): void {
  if (!MICROSOFT_CLIENT_ID || MICROSOFT_CLIENT_ID === 'PASTE_YOUR_MICROSOFT_CLIENT_ID_HERE') {
    throw new Error('Microsoft-вход ещё не настроен: добавь Client ID своего приложения Microsoft в src/main/microsoftAuth.ts или переменную GROM_MICROSOFT_CLIENT_ID.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(MICROSOFT_CLIENT_ID)) {
    throw new Error('Client ID Microsoft должен быть GUID из раздела App registrations.');
  }
}

function assertSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Безопасное хранилище Windows недоступно. Токен не будет сохранён в открытом виде.');
  }
  // Electron can fall back to basic_text on some Linux setups; never persist refresh tokens that way.
  if (safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Система не предоставляет защищённое хранилище токенов. Вход отменён.');
  }
}

function saveSecureSession(session: StoredSession): void {
  assertSecureStorageAvailable();
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  const tempFile = `${SESSION_FILE}.tmp`;
  fs.writeFileSync(tempFile, encrypted, { mode: 0o600 });
  fs.renameSync(tempFile, SESSION_FILE);
}

function loadSecureSession(): StoredSession | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try { assertSecureStorageAvailable(); } catch {
    throw new Error('Не удаётся безопасно открыть Microsoft-сессию. Войди снова после восстановления защищённого хранилища.');
  }
  try {
    const plain = safeStorage.decryptString(fs.readFileSync(SESSION_FILE));
    const parsed = JSON.parse(plain) as StoredSession;
    if (!parsed.refreshToken || !parsed.profile?.name || !parsed.profile?.uuid) throw new Error('Invalid session');
    return parsed;
  } catch {
    throw new Error('Сохранённая Microsoft-сессия повреждена. Войди в Microsoft заново.');
  }
}

function clearSecureSession(): void {
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch { /* best effort */ }
}

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

async function exchangeAuthorizationCode(code: string, redirectUri: string, verifier: string): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: 'XboxLive.signin offline_access',
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
  });
  const data = await response.json() as OAuthTokenResponse;
  if (!response.ok || !data.access_token) {
    const hint = data.error === 'invalid_client'
      ? 'Проверь Client ID и тип приложения Mobile and desktop applications.'
      : data.error === 'invalid_grant'
        ? 'Код входа истёк или был использован повторно. Попробуй ещё раз.'
        : 'Microsoft не выдал токен. Проверь регистрацию приложения и попробуй ещё раз.';
    throw new Error(hint);
  }
  return data;
}

async function refreshMicrosoftToken(refreshToken: string): Promise<OAuthTokenResponse> {
  ensureConfigured();
  const body = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'XboxLive.signin offline_access',
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
  });
  const data = await response.json() as OAuthTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error('Сессия Microsoft истекла. Войди через Microsoft заново.');
  }
  return data;
}

async function exchangeForMinecraft(msAccessToken: string): Promise<MinecraftLaunchSession> {
  // @xmcl/user handles the Xbox Live/XSTS and Minecraft token exchange.
  // Tokens remain in the Electron main process and are never returned to React.
  const authenticator = new MicrosoftAuthenticator({});
  const signal = AbortSignal.timeout(60_000);
  const { minecraftXstsResponse } = await authenticator.acquireXBoxToken(msAccessToken, signal);
  const xui = (minecraftXstsResponse as any)?.DisplayClaims?.xui?.[0];
  if (!xui?.uhs || !(minecraftXstsResponse as any)?.Token) {
    throw new Error('Xbox не подтвердил аккаунт. Проверь вход и настройки Xbox privacy.');
  }

  const minecraftToken = await authenticator.loginMinecraftWithXBox(xui.uhs, (minecraftXstsResponse as any).Token, signal);
  const accessToken = (minecraftToken as any)?.access_token as string | undefined;
  if (!accessToken) throw new Error('Minecraft Services не выдал игровой токен.');

  const profileResponse = await fetch(MINECRAFT_PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (profileResponse.status === 404) {
    throw new Error('У этого Microsoft-аккаунта не найден профиль Minecraft Java Edition. Проверь, что игра куплена на этом аккаунте.');
  }
  if (!profileResponse.ok) {
    throw new Error('Не удалось проверить Minecraft-профиль. Попробуй позже.');
  }
  const profile = await profileResponse.json() as { id?: string; name?: string };
  if (!profile.id || !profile.name || !/^[0-9a-f]{32}$/i.test(profile.id.replace(/-/g, ''))) {
    throw new Error('Microsoft вернул неполный Minecraft-профиль.');
  }

  return {
    name: profile.name,
    uuid: profile.id.replace(/-/g, ''),
    source: 'microsoft',
    accessToken,
  };
}

async function waitForAuthorizationCode(openExternal: (url: string) => Promise<unknown>): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const result = await new Promise<{ code: string; redirectUri: string; verifier: string }>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const server = http.createServer((req, res) => {
      if (settled) { res.writeHead(410); res.end(); return; }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404); res.end('Not found'); return; }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Неверный OAuth state. Вернись на страницу входа Microsoft.');
        return;
      }
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        settled = true;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><meta charset="utf-8"><title>Grom Client</title><body style="background:#111;color:#eee;font:16px sans-serif;padding:40px">Вход отменён. Вернись в Grom Client.</body>');
        reject(new Error(oauthError === 'access_denied' ? 'Ты отменил вход Microsoft.' : 'Microsoft отменил авторизацию. Попробуй ещё раз.'));
        server.close();
        if (timeout) clearTimeout(timeout);
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        settled = true;
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Код авторизации отсутствует. Вернись в Grom Client.');
        reject(new Error('Microsoft не вернул код авторизации.'));
        server.close();
        if (timeout) clearTimeout(timeout);
        return;
      }
      settled = true;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>Grom Client</title></head><body style="background:#101010;color:#f5f5f5;font:16px Segoe UI,Arial,sans-serif;padding:48px"><h2>Вход завершён</h2><p>Можно вернуться в Grom Client и закрыть эту вкладку.</p></body></html>');
      resolve({ code, redirectUri: `http://localhost:${(server.address() as import('node:net').AddressInfo).port}`, verifier });
      server.close();
      if (timeout) clearTimeout(timeout);
    });

    server.on('error', () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(new Error('Не удалось запустить локальный OAuth-приёмник. Закрой другие экземпляры лаунчера и попробуй ещё раз.'));
    });

    server.listen(0, 'localhost', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        settled = true;
        server.close();
        reject(new Error('Не удалось получить локальный порт Microsoft-входа.'));
        return;
      }
      // Microsoft allows the ephemeral port for a registered localhost desktop redirect.
      const redirectUri = `http://localhost:${address.port}`;
      const query = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: 'XboxLive.signin offline_access',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        server.close();
        reject(new Error('Время ожидания входа Microsoft истекло. Попробуй ещё раз.'));
      }, 5 * 60 * 1000);
      try {
        await openExternal(`${AUTHORIZE_ENDPOINT}?${query.toString()}`);
      } catch {
        settled = true;
        server.close();
        if (timeout) clearTimeout(timeout);
        reject(new Error('Не удалось открыть браузер для входа Microsoft.'));
      }
    });
  });
  return result;
}

export async function loginWithMicrosoft(openExternal: (url: string) => Promise<unknown>): Promise<MinecraftProfileSummary> {
  ensureConfigured();
  assertSecureStorageAvailable();
  const { code, redirectUri, verifier } = await waitForAuthorizationCode(openExternal);
  const msTokens = await exchangeAuthorizationCode(code, redirectUri, verifier);
  if (!msTokens.refresh_token) {
    throw new Error('Microsoft не выдал обновляющий токен. Проверь разрешение offline_access в приложении.');
  }
  const mc = await exchangeForMinecraft(msTokens.access_token!);
  saveSecureSession({
    refreshToken: msTokens.refresh_token,
    profile: { name: mc.name, uuid: mc.uuid, source: 'microsoft' },
    savedAt: Date.now(),
  });
  return { name: mc.name, uuid: mc.uuid, source: 'microsoft' };
}

export function getSavedMicrosoftAccount(): MinecraftProfileSummary | null {
  try { return loadSecureSession()?.profile ?? null; } catch { return null; }
}

export function logoutMicrosoft(): void {
  clearSecureSession();
}

export async function getMinecraftLaunchSession(): Promise<MinecraftLaunchSession | null> {
  const stored = loadSecureSession();
  if (!stored) return null;
  const tokens = await refreshMicrosoftToken(stored.refreshToken);
  const minecraft = await exchangeForMinecraft(tokens.access_token!);
  if (tokens.refresh_token) {
    saveSecureSession({
      refreshToken: tokens.refresh_token,
      profile: { name: minecraft.name, uuid: minecraft.uuid, source: 'microsoft' },
      savedAt: Date.now(),
    });
  }
  return minecraft;
}

export async function applySavedSkinToMicrosoft(skinPath: string, variant: 'classic' | 'slim' = 'classic'): Promise<void> {
  if (!fs.existsSync(skinPath)) throw new Error('Скин ещё не сохранён. Сначала нажми «Сохранить скин».');
  const buffer = fs.readFileSync(skinPath);
  if (buffer.length > 256 * 1024 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a' || buffer.readUInt32BE(16) !== 64 || buffer.readUInt32BE(20) !== 64) {
    throw new Error('Нужен PNG-скин размером ровно 64×64 пикселя (до 256 КБ).');
  }
  const session = await getMinecraftLaunchSession();
  if (!session) throw new Error('Сначала войди через Microsoft.');

  const form = new FormData();
  form.append('variant', variant);
  const blobBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(blobBuffer).set(buffer);
  form.append('file', new Blob([blobBuffer], { type: 'image/png' }), 'grom-skin.png');
  const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: form,
  });
  if (response.status === 401) throw new Error('Токен Minecraft истёк. Перезапусти лаунчер и войди через Microsoft заново.');
  if (response.status === 403) throw new Error('Minecraft Services отклонил изменение скина. Проверь наличие профиля Java Edition и повтори попытку.');
  if (!response.ok) throw new Error(`Не удалось применить скин к аккаунту Minecraft (HTTP ${response.status}).`);
}
