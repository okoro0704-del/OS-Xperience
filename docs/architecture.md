# OS Xperience architecture

OS Xperience is a participation and review layer. It records developer submissions, evidence, declared capabilities, review decisions, publication status, and audit history. It does not execute applications or become their backend.

OS Shell remains the operating and mediation layer: it determines which application handles a human intent. Xperience determines whether an existing application is prepared and allowed to participate. The `ShellRegistryPort` is an integration boundary, not a copied application registry.

LifeOS and mybrandOS remain their own product domains. Trust ID may provide a future safe identity assertion; it does not replace application accounts or supply biometrics. ElfCom remains messaging infrastructure; FundzMan remains financial infrastructure; Sovereign Drive remains storage infrastructure. Xperience declares participation only.

The monorepo additions are `apps/xperience-console`, `api`, `packages/xperience-contract`, and `packages/xperience-sdk`. Domain logic lives in the API, transport-neutral wire contracts in the shared package, and the console is a separate React/Vite surface.

## Persistence and identity

`api/prisma/schema.prisma` and its initial SQL migration define PostgreSQL durable records. `ApplicationRepository` is the persistence seam: `PrismaApplicationRepository` is for configured production infrastructure, while the memory implementation is an **explicit** test/dev adapter (`XPERIENCE_REPOSITORY=memory`) and is forbidden in production. Route handlers never call Prisma directly. The API fails closed when persistence is required but `DATABASE_URL` is missing.

Developer and admin consoles are API-backed: they read and mutate server state through the shared contract/SDK. Review transitions and audit events are authoritative on the server. `APPROVED` does not auto-publish; capability approval is not runtime authorization.

The consumer mobile app (`apps/xperience-mobile`) and consumer web app (`apps/os-experience`) are the user-side realization of publication: **Directory** lists `PUBLISHED` applications only, **Experience** adds membership to **My Experience**, and **Stop Experiencing** removes membership without deleting Directory publication. Experience selections persist via `ExperienceSelection` (not a separate marketplace/install database).

**LifeOS / Digiconomy Directory projection:** Eligible LifeOS verticals may appear in Directory through a thin read-only `LifeOSCatalogPort` (`LIFEOS_DIRECTORY_CATALOG_URL` or `LIFEOS_DIRECTORY_CATALOG_JSON`). Eligibility requires public visibility, published state, and valid HTTPS destinations. LifeOS remains the source of identity; OS Experience does not copy verticals into a second Application registry. Xperience-published rows win on ID collision. `ExperienceSelection.applicationId` is an opaque identity (no Application FK) so ecosystem apps can be experienced without duplicating ownership.

**Product separation:**
- **OS Experience** (`apps/os-experience`, `apps/xperience-mobile`, shared `@digiconomy/xperience-ui`) — consumer Home / Directory / My Experience / Voice objective surface
- **Xperience** (`apps/xperience-console`) — developer/admin registration and review
- **OS Shell** (`apps/web`) — thin operating surface; remains a separate product and must not be confused with OS Experience consumer UI

**Shared presentation:** Web/PWA, Android, and iOS consumers render the same `ExperienceApp` from `packages/xperience-ui` (design tokens + interaction language). Packaging uses Capacitor under `apps/os-experience` (`com.digiconomy.osexperience`) for **both** `android/` and `ios/` from one web build — separate from OS Shell (`com.digiconomy.osshell`).

### Cross-platform constitution

OS Xperience is **one product** with three distributions:

| Layer | Owns |
|-------|------|
| Shared core (`packages/xperience-ui`) | Home, Directory, My Experience, Profile, ExperienceMode, `exitExperienceToHome()`, two-finger classifier, Air Navigation engine, design system |
| Platform adapters (`apps/os-experience`) | Safe areas / insets, system Back, lifecycle, camera/mic permissions, packaging |
| Web/PWA | `env(safe-area-inset-*)`, browser permissions, service worker |
| Android shell | `WindowInsets` → `--ox-safe-*`, host two-finger over WebView, APK |
| iOS shell | WKWebView safe areas / contentInset, IPA when macOS/Xcode available |

Build: shared web → `cap sync` → Android Gradle and/or iOS Xcode. Do not fork UI per platform.

Platform matrix values: ✓ verified, NV = not verified on that runtime (never report PASS for NV).


Authentication is a provider boundary. Production resolves through the Trust ID-compatible provider and fails closed until that provider is connected. The development adapter is available only with both `NODE_ENV=development` and `XPERIENCE_DEV_AUTH=true`; it is not an identity system and never proves application control.
