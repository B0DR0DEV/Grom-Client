import { supabase } from './supabaseClient';
import { getSessionToken } from './auth';

const PUBLISHED_KEY = 'grom-skin-published';

async function digest(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Uploads the skin so other Grom players see it in game (via CustomSkinLoader). */
export async function publishSkin(dataUrl: string): Promise<{ ok: boolean; error?: string }> {
  const token = getSessionToken();
  if (!token) return { ok: false, error: 'Чтобы скин видели другие игроки, выйди и войди в аккаунт заново' };
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const { data, error } = await supabase.rpc('publish_skin', { p_token: token, p_png_b64: b64 });
  if (error) return { ok: false, error: /Could not find the function|PGRST202/i.test(error.message || '') ? 'Облачные скины ещё не включены на сервере' : error.message };
  if (!data?.ok) return { ok: false, error: data?.error || 'Не удалось опубликовать скин' };
  try { localStorage.setItem(PUBLISHED_KEY, await digest(dataUrl)); } catch {}
  return { ok: true };
}

/** Publishes the locally saved skin if it changed since the last upload. Silent. */
export async function syncSavedSkin() {
  try {
    const saved = await window.grom.loadSavedFile('skin');
    if (!saved || typeof saved !== 'string' || !saved.startsWith('data:image/png')) return;
    if (localStorage.getItem(PUBLISHED_KEY) === (await digest(saved))) return;
    await publishSkin(saved);
  } catch {}
}
