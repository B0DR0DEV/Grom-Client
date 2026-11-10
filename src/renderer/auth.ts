import { supabase } from './supabaseClient';

export interface Account {
  id: string;
  nickname: string;
  avatar_url: string | null;
  status: string;
  created_at: string;
}

const TOKEN_KEY = 'grom-token';
export const getSessionToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const saveToken = (t?: string) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} };
export const hasSession = () => getSessionToken().length > 0;
/** PGRST202 = функция не найдена на сервере. */
const rpcMissing = (e: any) => e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || ''));
const SERVER_NOT_READY = 'Сервер обновляется. Попробуй войти через пару минут.';

// РЕГИСТРАЦИЯ — пароль хеширует сервер (register_account); тот же аккаунт работает на сайте и в лаунчере
export async function register(
  nickname: string,
  password: string,
  avatarFile: File | null
): Promise<{ success: boolean; account?: Account; error?: string }> {
  try {
    let avatarUrl: string | null = null;
    if (avatarFile) {
      const fileName = `avatars/${nickname}-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage.from('chat-files').upload(fileName, avatarFile);
      if (!uploadError) avatarUrl = supabase.storage.from('chat-files').getPublicUrl(fileName).data.publicUrl;
    }
    const { data, error } = await supabase.rpc('register_account', { p_nickname: nickname, p_password: password, p_avatar_url: avatarUrl });
    if (rpcMissing(error)) return { success: false, error: SERVER_NOT_READY };
    if (error) throw error;
    if (!data?.ok) return { success: false, error: data?.error || 'Не удалось зарегистрироваться' };
    saveToken(data.token);
    return { success: true, account: data.account as Account };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ВХОД — пароль проверяет сервер (login_account); работает и для аккаунтов, созданных на сайте
export async function login(
  nickname: string,
  password: string
): Promise<{ success: boolean; account?: Account; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('login_account', { p_nickname: nickname, p_password: password });
    if (rpcMissing(error)) return { success: false, error: SERVER_NOT_READY };
    if (error) throw error;
    if (!data?.ok) return { success: false, error: data?.error || 'Неверный ник или пароль' };
    saveToken(data.token);
    return { success: true, account: data.account as Account };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function logout() {
  const t = getSessionToken();
  saveToken();
  if (t) await supabase.rpc('logout_session', { p_token: t }).then(() => {}, () => {});
}

// ПОЛУЧИТЬ АККАУНТ ПО НИКУ
export async function getAccount(nickname: string): Promise<Account | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id, nickname, avatar_url, status, created_at')
    .eq('nickname', nickname)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    nickname: data.nickname,
    avatar_url: data.avatar_url,
    status: data.status,
    created_at: data.created_at,
  };
}