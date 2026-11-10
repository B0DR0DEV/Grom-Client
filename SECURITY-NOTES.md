# Security cleanup notes

- Removed `vite-plugin-node-polyfills` from the renderer build and its dependency list. The renderer source does not import Node built-ins directly; Electron main-process Node APIs remain in the Electron main bundle. This removes the `crypto-browserify` -> `elliptic` chain introduced by the renderer polyfill.
- Removed the project `.npmrc` because it contained pnpm-only `node-linker` and `shamefully-hoist` settings, which npm warns about.
- No `npm audit fix --force` was applied. In the audit report supplied for this project, npm proposed downgrading packages.
- `sprintf-js` <= 1.1.3 currently has no published patched release for GHSA-hp3w-g68c-fv3c. In this project it is pulled in through Electron Builder's build/download tooling. The project audit can still report this moderate advisory until the upstream dependency chain ships a fix; it should not be hidden with an audit override.

## Clean reinstall on Windows (npm)

From the project root, after extracting this source archive:

```bat
rmdir /s /q node_modules
del package-lock.json
npm install
npm audit
```

The commands above regenerate npm's dependency tree from the updated `package.json`. Keep the existing `pnpm-lock.yaml` only if you also use pnpm; npm does not use it.


## Microsoft sign-in and skin upload

- Uses authorization-code OAuth with PKCE, a random `state`, the OS browser, and an ephemeral localhost callback.
- Never asks for or receives the user's Microsoft password inside the launcher.
- The main process performs token exchange; access tokens are not returned through the preload IPC bridge.
- The refresh token is encrypted through Electron `safeStorage`; if encryption is unavailable or the selected backend is `basic_text`, sign-in is rejected rather than writing plaintext.
- A public client ID is required for the OAuth app registration. No client secret belongs in a desktop application.
- The normal Java launcher still places the short-lived Minecraft access token in the Java command-line arguments because Minecraft's launch arguments require it. The launcher does not write that token to its debug log, but other processes running as the same OS user may be able to inspect process arguments.
- Skin upload is sent directly from the main process to `api.minecraftservices.com` and requires an authenticated Minecraft Java profile.
- Microsoft OAuth and Minecraft skin-upload flows have not been live-tested in this environment; validate them with a test account and a registered Client ID before publishing.
