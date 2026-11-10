// Отдаёт скины игроков Grom в формате PNG: GET /functions/v1/skin/<ник>.png
// Деплой: supabase functions deploy skin --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const m = new URL(req.url).pathname.match(/\/([A-Za-z0-9_]{1,16})\.png$/);
  if (!m) return new Response('not found', { status: 404 });
  const { data, error } = await sb.rpc('get_skin', { p_nickname: m[1] });
  if (error) return new Response('error', { status: 500 });
  if (!data) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  const bytes = Uint8Array.from(atob(data as string), (c) => c.charCodeAt(0));
  return new Response(req.method === 'HEAD' ? null : bytes, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
  });
});
