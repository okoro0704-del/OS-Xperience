# OS Experience — iOS shell

Native shell for the **same** shared web build as Web/PWA and Android (`apps/os-experience`).

## Requirements

- macOS with Xcode
- CocoaPods (`pod install` in `App/`)
- Apple developer signing for device/IPA

## Commands (from repo root)

```bash
npm run ios:experience:sync
npm run cap:ios -w @digiconomy/os-experience
```

On this Windows development host: **sync creates/updates the Xcode project; compile/simulator/device are NOT VERIFIED.**

## Shared contract

Safe areas are pushed into CSS `--ox-safe-*` via `AppDelegate` (same layout contract as Android `MainActivity` WindowInsets). ExperienceMode, two-finger escape (shared JS classifier), and Air Navigation live in `@digiconomy/xperience-ui` and call `exitExperienceToHome()`.
