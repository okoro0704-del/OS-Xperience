# Production Hardening (OS Shell 2.0.1)

Feature freeze remains **OS Shell 2.0**. This release hardens the existing Shell for production; it does not add a 2.1 plane.

Protocol stays `channel: "os-shell"`, `version: "0.7"`.

## Environment configuration

Modes: `development` | `staging` | `production`.

Vite variables (apps/web):

| Variable | Purpose |
| --- | --- |
| `VITE_SHELL_MODE` | Build boundary |
| `VITE_SHELL_ORIGINS` | Shell host origins (comma-separated) |
| `VITE_MYBRANDOS_ORIGINS` | mybrandOS trusted origins |
| `VITE_LIFEOS_ORIGINS` | LifeOS trusted origins |
| `VITE_COMPATIBLE_ORIGINS` | Compatible third-party origins (empty in production by default) |

Rules:

- Production/staging **reject loopback** (`localhost`, `127.0.0.1`).
- First-party production origins must be `https://` or Capacitor (`capacitor://…`).
- Development features (simulation, localhost trust shortcuts) are impossible when `allowDevelopmentFeatures` is false.
- Never hardcode environment-specific origins inside application logic — use `readShellEnvironmentFromVite()` / `originPolicyFromEnvironment()`.

Examples: `.env.development`, `.env.production.example`, `.env.staging.example`.

## Origin security

- Privileged `postMessage` never uses `*`.
- Origin policy is explicit; production never falls back to localhost native origins.
- Manifest identity, application ID, and origin must align before participation.

## Identity

- Trust states remain explicit: anonymous / authenticated / verified / first-party.
- Client storage, query params, deep links, and `postMessage` payloads are **not** proof of identity.
- Simulation / development authentication cannot run in production builds.

## Capabilities

Permanent distinction:

`GRANTED ≠ EXECUTING ≠ AUTHENTICATED ≠ PAID ≠ STREAMING`

The Shell mediates; applications execute. The Shell must never receive passwords, OTPs, PINs, private keys, session tokens, bank credentials, camera/mic streams, or raw media.

## Sessions

States: `CREATED` → `ACTIVE` → `BACKGROUND` → `SUSPENDED` → `ENDED`.

Session references are not authentication. Session tokens must not appear in URLs, deep links, object references, intents, operating context, or handoff payloads.

## Object references & intents

Object reference ≠ authorization. Intents validate schema, size, origin, target application, object references, capabilities, and confirmation for consequential actions (`publish`, `purchase`, `send`, `transfer`, `delete`, `go live`, `deploy`).

## Operating context & storage

Shell may retain current / recent / preference / availability / relationship context — never application private data, credentials, payment data, or media streams.

Stores use bounded size, schema validation, secret rejection (`jsonLeaksSecrets`), and corrupt-entry clearing (`safeGetJson` / `safeSetJson`).

## URL & deep links

`application://` routes are hints only — never identity or authorization.

Launch URLs strip: `token`, `access_token`, `session`, `password`, `secret`, `api_key`, `private_key`, `otp`, `pin`, and related keys.

## Network & failure

Honest states: `OFFLINE`, `UNAVAILABLE`, `TIMEOUT`, `UNKNOWN`. Never fake success. One application failure must not crash the Shell.

## PWA

- Manifest: `/manifest.webmanifest`
- Service worker: `/sw.js` (Shell UI assets only; no credentials/private app data)
- Update UX: “New version available” → Reload (does not silently destroy work without user action)
- Install / update / offline restore covered by SW cache versioning (`os-shell-2.0.1`)

## Architecture guard

Rejected class names include marketplace/app-store backends, AppInstallationEngine, UniversalInstaller, ShellFilesystem, ShellNotificationBackend, plus prior AI/context/media engine bans.

Canonical six primitives only: trust-id, elfcom, sovereign-drive, platform-jobs, master-distributor, fundzman.

## Railway (web host)

Live production Shell:

- URL: https://os-shell-production.up.railway.app
- Project: `OS-Xperience`
- Service: `os-shell`
- GitHub: https://github.com/okoro0704-del/OS-Xperience

Service variables (build-time for Vite):

| Variable | Purpose |
| --- | --- |
| `VITE_SHELL_MODE` | `production` |
| `VITE_SHELL_ORIGINS` | Railway public URL + Capacitor hosts |
| `VITE_MYBRANDOS_ORIGINS` | Trusted mybrandOS HTTPS origins |
| `VITE_LIFEOS_ORIGINS` | Trusted LifeOS HTTPS origins |
| `VITE_COMPATIBLE_ORIGINS` | Optional third-party origins |
| `PORT` | `8080` (nginx listen) |

Replace `*.digiconomy.example` LifeOS / mybrandOS origins with real production hosts when ready, then redeploy.


```bash
npm test
npm run typecheck
npm run build
```

Hardening tests: `packages/contract/test/production-hardening.test.ts`.

## Release checklist (web)

- [ ] No localhost in production build
- [ ] No dev authentication / simulation
- [ ] No secrets in client
- [ ] Origin / manifest / capability / intent / session / context validation verified
- [ ] PWA install + update + offline verified
- [ ] Storage corruption recovery verified
- [ ] Architecture guard green
- [ ] All tests green
