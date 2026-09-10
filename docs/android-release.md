# Android Release — OS Shell APK

The Android app is a **distribution of the same web Shell**, not a second Shell architecture.

Package ID: `com.digiconomy.osshell`  
Product name: **OS Shell**  
Release version: aligned with Shell `2.0.1`

## Architecture

```
Android Activity (Capacitor WebView)
        ↓
Production OS Shell web runtime (apps/web dist)
        ↓
Existing contracts (Discover / Objective / Preference / Continuity / Context)
        ↓
Applications (LifeOS / mybrandOS / third-party)
```

Capacitor packages the built web assets. Do not introduce a parallel frontend.

## Build environment

| Tool | Requirement |
| --- | --- |
| Node | ≥ 20 (pin with `.nvmrc` / engines) |
| Package manager | npm (workspace) |
| Java | JDK 17+ (Android Gradle Plugin) |
| Android SDK | API 34+ recommended; minSdk 24 |
| Gradle | Wrapper in `android/` |

## Environment variables

Release APK must use production (or staging) configuration:

```bash
# apps/web/.env.production
VITE_SHELL_MODE=production
VITE_SHELL_ORIGINS=capacitor://localhost,https://shell.digiconomy.example
VITE_MYBRANDOS_ORIGINS=https://mybrandos.digiconomy.example
VITE_LIFEOS_ORIGINS=https://lifeos.digiconomy.example
VITE_COMPATIBLE_ORIGINS=
```

No localhost HTTP. No development Trust ID. No mock applications. No simulation.

## Commands

```bash
# 1. Production web build
cp apps/web/.env.production.example apps/web/.env.production
# edit origins, then:
npm run build -w @osshell/web

# 2. Sync native project
npx cap sync android

# 3. Release APK (unsigned until keystore configured)
cd android
# Windows — use Android Studio JBR if java is not on PATH:
#   set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
gradlew.bat assembleRelease
# macOS/Linux: ./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release-unsigned.apk` (or signed `app-release.apk` when `android/keystore.properties` is present).

Package ID: `com.digiconomy.osshell` · versionName `2.0.1` · versionCode `201`.

## Signing

- Do **not** commit private keystores or passwords.
- Use `android/keystore.properties` (gitignored) or CI secrets.
- Configure `signingConfigs.release` in `android/app/build.gradle`.
- Debug / staging / release product flavors may exist; only **release** produces the production APK.

## WebView security

- Production HTTPS / Capacitor origins only
- No remote debugging in release
- No arbitrary file / universal access
- Mixed content blocked
- Minimal JS bridge (lifecycle, network, open external URL, share) — never credentials, filesystem, or secrets

## Permissions

Initial Shell APK requests **no** camera, microphone, contacts, location, SMS, or phone permissions.

Applications that need those capabilities request and execute them themselves.

## Back button

```
Application history → Shell history → WebView history → Exit
```

## Lifecycle

Map Android lifecycle into existing session presence: `ACTIVE` / `BACKGROUND` / `SUSPENDED`. Do not invent a second session model.

## Deep links

Approved App Links (example): `https://shell.digiconomy…/…`

Validate every route. Deep-link parameters are never authorization.

## Installation boundary

The Shell does **not** download/install APKs or host a Marketplace. Acquisition stays with Digiconomy Marketplace; the Shell uses applications.

## Testing

- Install release APK on device/emulator
- Verify branding, startup, navigation, registry, objectives, preferences, continuity, context
- Back, background/resume, offline/reconnect, deep links
- Parity with production web Shell behavior

## Observability

Production logs must never contain passwords, OTPs, PINs, tokens, cookies, private keys, or payment credentials. Prefer operational failure signals only.
