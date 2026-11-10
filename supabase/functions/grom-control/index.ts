import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expectedHash = Deno.env.get("GROM_ADMIN_CODE_SHA256");
  if (!url || !serviceKey) return json({ error: "Server is not configured." }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (body.action === "status") {
    const { data, error } = await db.from("launcher_control").select("id,required,version,features,website_url,updated_at").eq("id", 1).maybeSingle();
    if (error) return json({ error: "Unable to read release status." }, 500);
    return json({ status: data });
  }
  if (!expectedHash) return json({ error: "Admin code is not configured on the server." }, 503);
  const provided = typeof body.code === "string" ? body.code : "";
  const actualHash = await sha256(provided);
  if (!provided || actualHash !== expectedHash) return json({ authorized: false, error: "Invalid admin code." }, 403);
  if (body.action === "authorize") return json({ authorized: true });
  if (body.action !== "publish") return json({ error: "Unknown action." }, 400);
  const version = typeof body.version === "string" ? body.version.trim().slice(0, 30) : "";
  const features = Array.isArray(body.features) ? body.features.filter((x) => typeof x === "string").slice(0, 30).map((x) => x.trim().slice(0, 300)) : [];
  const required = body.required === true;
  if (!version || features.length === 0) return json({ error: "Version and release notes are required." }, 400);
  const websiteUrl = "https://gromclient.devs.li";
  const { error } = await db.from("launcher_control").upsert({ id: 1, required, version, features, website_url: websiteUrl, updated_at: new Date().toISOString() });
  if (error) return json({ error: "Could not publish release status." }, 500);
  return json({ success: true });
});
