// Все изменения аккаунта и сообщений идут через серверные функции с токеном сессии.
// Сервер сам знает, кто ты, по токену — лаунчер больше не сообщает ему ник «на слово».
import { supabase } from './supabaseClient';
import { getSessionToken } from './auth';

export const ACCOUNT_COLUMNS = 'id, nickname, avatar_url, status, created_at';

type Ok = { ok: boolean; error?: string };

async function call<T = Ok>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { p_token: getSessionToken(), ...args });
  if (error) throw new Error(error.message);
  return data as T;
}

async function callOk(fn: string, args: Record<string, unknown>): Promise<void> {
  const res = await call<Ok>(fn, args);
  if (!res?.ok) throw new Error(res?.error || 'Не удалось выполнить действие');
}

export const accountApi = {
  touch: () => callOk('account_touch', {}),
  update: (fields: { avatarUrl?: string; status?: string; nickname?: string }) =>
    callOk('account_update', {
      p_avatar_url: fields.avatarUrl ?? null,
      p_status: fields.status ?? null,
      p_nickname: fields.nickname ?? null,
    }),
  setActivity: (activity: unknown | null, status?: string) =>
    callOk('account_set_activity', { p_activity: activity, p_status: status ?? null }),
};

export const dmApi = {
  history: <T>(withNick: string) => call<T[]>('dm_history', { p_with: withNick }),
  conversations: <T>() => call<T[]>('dm_conversations', {}),
  send: <T>(msg: {
    to: string; text?: string | null; fileUrl?: string | null; fileName?: string | null;
    replyToId?: string | null; replyToText?: string | null; replyToAuthor?: string | null;
  }) => call<T>('dm_send', {
    p_to: msg.to,
    p_text: msg.text ?? null,
    p_file_url: msg.fileUrl ?? null,
    p_file_name: msg.fileName ?? null,
    p_reply_to_id: msg.replyToId ?? null,
    p_reply_to_text: msg.replyToText ?? null,
    p_reply_to_author: msg.replyToAuthor ?? null,
  }),
  edit: (id: string, text: string) => callOk('dm_edit', { p_id: id, p_text: text }),
  remove: (id: string) => callOk('dm_delete', { p_id: id }),
};
