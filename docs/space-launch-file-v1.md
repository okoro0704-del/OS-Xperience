# Space Launch File V1

**Status: VERIFIED / FROZEN.** Physically accepted on an OPPO A5 (CPH2727, Android 16, Google WebView
153.0.8010.36). See [V1 freeze](#v1-freeze) before changing anything below.

**The Space Launch File is not the Space.** It is the small, trusted descriptor that lets OS Xperience
discover, verify, register, prepare and launch a provider's SPACE execution target.

```
SPACE FILE → OS XPERIENCE → VERIFY → REGISTER → XPERIENCE SPACE → PREPARE
  → OFFLINE KERNEL / LOCAL STATE → READY OFFLINE → SPACE RUNTIME → PRODUCT SPACE
```

The launch file describes. Local infrastructure (the Offline Kernel) stores. The Space Runtime executes.

## Non-goals

A launch file is not an APK, not the application, not an offline copy of a website, not a media
bundle, not PDI and not TrustID. V1 adds no marketplace, store, payments, DRM, sync, peer-to-peer
transfer, plugins or executable packages.

## Artifact

| | |
|---|---|
| Extension | `.space` |
| MIME type | `application/vnd.digiconomy.space+json` |
| Picker filter | `.space,application/vnd.digiconomy.space+json,application/octet-stream` (acquisition only, see below) |
| Container | a single UTF-8 JSON document (LF line endings, see `.gitattributes`) |
| Maximum size | 16 KiB (`SPACE_LAUNCH_MAX_BYTES`), checked before parsing |
| Executable code | **not permitted** — the schema is a closed allowlist |

It must never contain application source, a web application, media, episodes, executable
JavaScript, credentials (TrustID, PDI, API) or private keys. Any field outside the schema is rejected.

## Schema (`schemaVersion: 1`)

```json
{
  "format": "digiconomy.space",
  "schemaVersion": 1,
  "payload": {
    "providerId": "bootstrap.mybrandos.public",
    "publisherId": "mybrandos",
    "version": "1.0.0",
    "presentation": { "name": "MrFundzMan", "description": "…", "icon": "https://… (optional)" },
    "execution": { "mode": "SPACE", "broadcastChannelId": "mrfundzman.tv" },
    "capabilities": ["space.tv"],
    "preparation": { "kind": "BROADCAST", "endpoint": "https://… (optional)" },
    "compatibility": { "minimumXperienceVersion": "0.3.6", "minimumSpaceRuntimeVersion": 1 }
  },
  "integrity": { "algorithm": "SHA-256", "digest": "<64 hex>" },
  "signature": { "algorithm": "Ed25519", "keyId": "mybrandos-space-2026-10", "value": "<base64, 64 bytes>" }
}
```

Field rules:

- `providerId`, `publisherId`, `keyId`, `broadcastChannelId`: lowercase identifiers
  (`[a-z0-9._-]`, ≤ 128 chars, no `..`, no slashes) — no path can be expressed.
- `version`, `minimumXperienceVersion`: numeric semver `MAJOR.MINOR.PATCH`.
- `execution` reuses the signed catalog's SPACE target shape (`CatalogExecutionTarget`); `mode` must be `SPACE`.
- `capabilities` must include `space.tv`; unknown-to-runtime capabilities are `INCOMPATIBLE_RUNTIME`.
- URLs (`icon`, `endpoint`) must be `https:`, ≤ 512 chars, without credentials.
- Duplicate keys anywhere in the document are rejected (`JSON.parse` would silently keep the last).

Deliberately absent, because they are already canonical elsewhere: origin, entrypoint, auth mode and
offline capability (the provider's trusted record), release state and visibility (the signed catalog),
and prepared state (the Offline Kernel).

## Canonicalization and signing

The signed content is the canonical JSON (recursively sorted keys, no whitespace — the same
`canonicalJson` used by the signed Experience catalog) of `{ format, schemaVersion, payload }`.

- `integrity.digest` = SHA-256 of the signed content (detects damage/tampering early).
- `signature.value` = Ed25519 signature of the signed content by the publisher key `keyId`.

Publishers sign with `scripts/sign-space-launch-file.mjs`; the private key is read from a file outside
the repository (`SPACE_PUBLISHER_KEY_FILE`) and is never printed. OS Xperience holds public keys only.

## Acquisition (picker)

Android has no MIME mapping for `.space`, so its media index types launch files as
`application/octet-stream`, and Capacitor drops extensions Android cannot map from the picker filter.
With only the V1 MIME type in the filter, the standard Android picker disables every `.space` file.
Import Space therefore also admits `application/octet-stream`.

This is a picker compatibility mechanism and nothing more. It does not change the MIME contract and
does not weaken verification: a pick larger than 16 KiB is refused before it is read
(`LAUNCH_FILE_TOO_LARGE`), and every other pick runs the complete pipeline below. An arbitrary
octet-stream file is `INVALID_FORMAT` and never becomes a Space.

## Trust model

A received file is untrusted until verified. Origin isn't trust — signature is trust. Filename,
extension, download URL, filesystem location, display name and provider name are never consulted.

```
RECEIVED → (size) → VALIDATING (UTF-8, JSON, duplicate keys, format, schemaVersion, schema)
  → VERIFYING (publisher pinned → integrity → signature → publisher authorized for provider)
  → COMPATIBILITY_CHECK (OS Xperience version, Space Runtime version, capabilities)
  → READY_TO_REGISTER (provider identity, conflicts, versions) → REGISTERED
```

Public-key source: `BUNDLED_SPACE_PUBLISHERS` (`packages/xperience-ui/src/local/space-publishers.ts`),
pinned into the build. Each publisher lists its key ids and the provider identities it may describe.

### Deterministic results

| Code | Stage | Meaning |
|---|---|---|
| `LAUNCH_FILE_TOO_LARGE` | RECEIVED | over 16 KiB |
| `INVALID_FORMAT` | VALIDATING | not UTF-8 / not JSON / duplicate keys / schema violation / unknown field |
| `UNSUPPORTED_SCHEMA` | VALIDATING | `schemaVersion` other than 1 |
| `PUBLISHER_UNKNOWN` | VERIFYING | publisher or key id not pinned |
| `INTEGRITY_FAILED` | VERIFYING | digest does not match content |
| `SIGNATURE_INVALID` | VERIFYING | signature does not verify with the pinned key |
| `IDENTITY_CONFLICT` | VERIFYING / READY_TO_REGISTER | publisher not authorized for the provider; channel owned by another identity; registered by another publisher; same version with different content |
| `INCOMPATIBLE_XPERIENCE` | COMPATIBILITY_CHECK | OS Xperience older than `minimumXperienceVersion` |
| `INCOMPATIBLE_RUNTIME` | COMPATIBILITY_CHECK | Space Runtime older than required, or unsupported capability |
| `PROVIDER_UNKNOWN` | READY_TO_REGISTER | provider is not in this installation's trusted sources |
| `ALREADY_INSTALLED` | READY_TO_REGISTER | same provider, same version, same content |
| `UPDATE_AVAILABLE` | READY_TO_REGISTER | newer valid version; replaced only with explicit consent (`acceptUpdate`) |
| `DOWNGRADE_REJECTED` | READY_TO_REGISTER | older than the registered version |
| `IMPORT_FAILED` | READY_TO_REGISTER | local persistence failed |

Consumer UI shows plain messages (`SPACE_IMPORT_MESSAGE`); cryptographic detail is never surfaced.

## Identity

A launch file never invents a product identity. `providerId` must name a provider this installation
already trusts — the verified signed catalog or the provider bundled into the build — so APP and SPACE
share one identity. If that provider already declares a SPACE channel, the file must declare the same
channel. A channel can belong to only one provider.

## Registration

`importSpaceLaunchFile(bytes, { xperienceVersion, acceptUpdate? })` stores the verified document under
`ox.space-registrations.v1` (installation-local key-value store). On every read, entries are
structurally re-validated and must still be bound to a pinned publisher; anything else is ignored,
so a corrupted registration fails safe (no Space) and a fresh verified import recovers.

## Readiness and preparation

INSTALLED / REGISTERED ≠ PREPARED ≠ READY OFFLINE.

Readiness is the existing Xperience Space model, computed from the Offline Kernel store with no route:
`NOT PREPARED` (online, nothing local) · `ONLINE PREPARATION REQUIRED` (offline, nothing local) ·
`READY OFFLINE` (the kernel can play the channel locally now). Readiness is bound to the prepared
schedule: when its last program ends, the Space truthfully stops reporting READY OFFLINE (the media stays
stored) until a newer schedule is prepared.

**Prepare** runs the existing `hydrateAndPrepareSpaceTv` with a route. The route is, in order: the host
shell's injected broadcast base, the launch file's `preparation.endpoint`, then the installation's
`VITE_MYBRANDOS_PUBLIC_API_BASE`. Media integrity is enforced per asset by the kernel (SHA-256 of the
published bytes). Installing a Space is tiny; preparing it may acquire substantial resources; running a
prepared Space needs no network.

## Upgrade semantics

Same provider + same version: `ALREADY_INSTALLED`. Newer valid version from the same publisher:
`UPDATE_AVAILABLE`, applied only on explicit consent. Older: `DOWNGRADE_REJECTED`. Another publisher
for the same provider: `IDENTITY_CONFLICT`. A trusted registration is never silently overwritten.

## Space resolution: multiple sources

A Space may be discoverable through more than one authoritative source. V1 has two:

- **Signed catalog release** — the verified signed Experience catalog lists the provider with a SPACE mode.
- **Local verified `.space` registration** — an entry in `ox.space-registrations.v1`.

(The provider's bundled/declared record can also declare a SPACE mode when no catalog entry exists.)

Resolution, as implemented by `providerTargets` (`packages/xperience-ui/src/local/targets.ts`):

1. **The provider has a signed catalog entry** → the entry is authoritative for release, visibility
   and modes. A registration neither adds nor removes anything.
2. **No catalog entry for the provider** → the provider's declared modes (its view, else the local
   registry entry, else the bundled bootstrap entry). A verified registration appends a SPACE target
   only when no SPACE mode is already declared.
3. **A signed catalog governs execution but does not carry the provider** → every target is
   `NOT_RELEASED`; a registration cannot release it.

**Invariant: removing one discovery source removes only that source.** If another valid source still
resolves the Space, SPACE remains available. Physical acceptance showed exactly this: the production
catalog releases MrFundzMan SPACE as LIVE, so after **Remove registration** the Space stayed available
(from the catalog) and still ran as SPACE. Where the registration is the only source (an APP-only
provider with no catalog SPACE), removal makes SPACE unavailable.

## APP / SPACE isolation

A registration contributes only a SPACE target; it never creates an APP target. Launching a Space does
not probe the APP URL. **SPACE → SPACE**: an explicitly requested mode runs as that mode or not at all
(`requireExecutionTarget`), so a Space that no source resolves is unavailable — it never falls back to
APP, and APP never falls back to Space.

## TrustID / PDI boundary

Importing or consuming a public Space requires no TrustID, creates or connects no PDI, and grants no
owner, admin or management authority. Consumption does not require identity. Authority does.

## Lifecycle

`RECEIVED → VALIDATED → VERIFIED → REGISTERED → NOT PREPARED → PREPARED → READY OFFLINE → RUNNING SPACE`

**Remove registration** removes the Space from Xperience Space and leaves prepared Offline Kernel data
in place. **Delete prepared data** is a separate, explicit action that V1 does not yet provide (the
kernel store has no deletion contract); it is the next lifecycle step.

## File opening

V1 surface: **Import Space** inside Xperience Space (file picker; works in browsers and in the Android
WebView through the standard system picker). Native Android `.space` association (tap file → Open with OS Xperience) is deferred: it needs
a VIEW intent filter plus native code to read `content://` URIs, a new APK and device verification.

## Example artifact

`apps/os-experience/public/spaces/mrfundzman.space` (931 bytes), source payload
`scripts/spaces/mrfundzman.payload.json`, signed by `mybrandos-space-2026-10`.

## Android storage (physical finding)

| | |
|---|---|
| Space registration | WebView localStorage — `app_webview/Default/Local Storage/leveldb` |
| Prepared Offline Kernel | WebView IndexedDB (`digiconomy-offline-kernel`) plus its blob store — `app_webview/Default/IndexedDB/https_localhost_0.indexeddb.{leveldb,blob}` |
| Force-stop / restart | preserved (verified across two offline force-stops) |
| Clear app data | expected destructive |
| Uninstall | destructive |
| Same-signature APK upgrade | expected to preserve |
| Signing-key change | forces uninstall, therefore destructive |
| WebView origin change (`https://localhost`) | potentially storage-breaking |
| `navigator.storage.persisted()` | `false` on the tested OPPO (best-effort storage; evictable under pressure) |

V1 does not change storage policy.

## Android network policy

Production and release builds forbid cleartext HTTP (`src/main/res/xml/network_security_config.xml`).
Physical acceptance reaches a local producer through `adb reverse` with a **debug-only** override,
`android/app/src/debug/res/xml/network_security_config.xml`, that permits cleartext to `localhost` and
`127.0.0.1` only. `scripts/build-os-experience-apk.mjs --release` refuses any release APK whose packaged
network configuration permits cleartext or carries a domain exception
(`scripts/android-network-policy.mjs`). Debug acceptance APKs must never be distributed or published
as an OTA release.

## V2 follow-ups

- **Durable storage policy** — request `navigator.storage.persist()` (or a native equivalent), surface
  eviction honestly, and define behaviour across clear-data, reinstall and signing-key changes.
- **Delete prepared data** — an explicit Offline Kernel deletion contract.
- **Native `.space` association** — VIEW intent filter and `content://` reading.

## V1 freeze

Frozen: the `.space` schema v1, the MIME contract, canonicalization, the integrity contract, the Ed25519
signature contract, the publisher/key model, publisher/provider authorization, compatibility rules,
registration semantics and APP/SPACE isolation semantics. Any incompatible change requires a new
`schemaVersion`; V1 is not mutated in place.
