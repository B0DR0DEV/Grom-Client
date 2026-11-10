# Remote Grom Client release control

This feature requires deployment to the Supabase project already configured in `src/renderer/supabaseClient.ts`. It will not broadcast until the following server setup is completed.

1. Run `migrations/20261021_launcher_control.sql` in Supabase SQL Editor.
2. Create a strong admin code (at least 20 random characters). Compute its SHA-256 hex digest locally and set the Edge Function secret `GROM_ADMIN_CODE_SHA256` to that digest. Never put the raw admin code or service-role key in the client source.
3. Deploy `functions/grom-control/index.ts` as the Edge Function `grom-control`. Set the standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets for the function.
4. Test the `status`, `authorize`, and `publish` actions before release.

The launcher checks status on startup and every 60 seconds. When `required=true` and the published version differs from the installed version, a blocking dialog displays release notes and opens https://gromclient.devs.li. Set `required=false` for a non-blocking release notice (the current UI only blocks for required updates).

Security: the admin code is hashed on the server, not embedded in the launcher. The function compares the SHA-256 digest of the supplied code to the secret hash and uses the service-role key only server-side. Add rate limiting at the edge/WAF before public release if available.
