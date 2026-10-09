# Digiconomy Space Package V1 (SP1)

A portable, immutable, publisher-signed Space. A package can be exported, copied by any means,
inspected and verified fully offline, and installed into another local Space Runtime without a
live server. Installation is not authentication: a package carries no owner, no grants and no
private data, and installing it gives the recipient none.

Implementation: `packages/space-package` (`@digiconomy/space-package`). CLI: `space`.

## 1. Container

| | |
|---|---|
| Archive | ZIP, strict subset of PKWARE APPNOTE 6.3 (below) |
| Media type | `application/vnd.digiconomy.space-package` |
| Recommended extension | `.space` (never evidence of validity) |
| Recognition | **by content only**: the first entry is `mimetype`, STORED, whose bytes are exactly the media type (the EPUB/ODF technique) |

`.space` is also the extension of the frozen **Space Launch File V1** (a ≤16 KB JSON descriptor,
`docs/space-launch-file-v1.md`). Each format refuses the other by content: a launch file is not a
ZIP (`NOT_A_SPACE_PACKAGE`); a package is not JSON (`INVALID_FORMAT` from the launch-file verifier).
Both directions are tested.

### Layout

```
mimetype                    application/vnd.digiconomy.space-package   (first, STORED)
META-INF/space.json         the manifest — canonical JSON
META-INF/signature.json     the publisher signature — canonical JSON
content/…                   assets, every one declared in the manifest
```

No other top-level paths are allowed (`UNDECLARED_ENTRY`); every `content/` entry must be declared
and every declared asset must be present.

### ZIP subset

Writers produce STORED entries in a fixed order with fixed timestamps (1980-01-01), UTF-8 names
and regular-file modes, so packing the same inputs yields byte-identical packages. Readers accept
STORED and DEFLATE and refuse:

| Refused | Code |
|---|---|
| Encryption, ZIP64, data descriptors, multi-disk, other methods | `UNSUPPORTED_ARCHIVE_FEATURE` |
| Archive comment or trailing/prepended data; central/local header disagreement; overlapping entries | `MALFORMED_ARCHIVE` |
| Absolute paths, drive letters, `..`/`.`/empty segments, backslashes, control or reserved characters, Windows device names, non-NFC names, directory entries | `UNSAFE_PATH` |
| Symlink (mode `0120000`) or any non-regular file | `SYMLINK_NOT_ALLOWED` / `UNSAFE_PATH` |
| The same path twice, including by case | `DUPLICATE_PATH` |
| More than 4,096 entries | `TOO_MANY_ENTRIES` |
| Archive > 256 MB; entry > 128 MB | `ARCHIVE_TOO_LARGE` / `ENTRY_TOO_LARGE` |
| Total uncompressed > 512 MB, DEFLATE ratio > 200:1, or inflating past the declared size (stopped while streaming) | `DECOMPRESSION_BOMB` |
| CRC-32 mismatch | `CRC_MISMATCH` |

Limits are in `LIMITS` and can only be tightened by a caller.

## 2. Manifest — `META-INF/space.json`

Exact-key schema: any field not listed is refused (no scripts, URLs to execute, credentials or
extensions slip through as "extra" data).

| Field | Content |
|---|---|
| `format`, `formatVersion` | `"digiconomy.space-package"`, `1` (other versions: `UNSUPPORTED_FORMAT_VERSION`) |
| `package` | `id` (reverse-DNS-style id), `version` (x.y.z), `name`, optional `description` |
| `publisher` | `publisherId`, `keyId` — a *reference* to a pinned key, never the key itself |
| `runtime` | `spaceContractVersion` (Space Runtime contract, currently 1), `minimumRuntimeVersion` |
| `space` | `spaceId`, `defaultExperienceId`, `experiences[]` — maps 1:1 onto the canonical `SpaceDefinition` (`packages/space-runtime`) |
| `experiences[]` | `id`, `title`, `type`, `entry` `{ type: "space.content-index/v1", path }`, `offlinePolicy` (`cached`/`unavailable`), `requires[]` (permissions) |
| `assets[]` | `path` (under `content/`), `mediaType`, `size`, `sha256` |
| `offline` | `capabilities[]` (`space.*`), optional `contentIndex` (a declared asset) |
| `permissions[]` | declared permissions (§5) |
| `dependencies[]` | `packageId`, `minimumVersion` |
| `license` | `spdx`, `duplication` (`ALLOWED` / `PERSONAL_COPIES` / `PROHIBITED`), `redistribution` |
| `provenance` | `createdAt`, `tool`, optional `parent` `{ packageId, version, integrityRoot }` |
| `integrity` | `{ algorithm: "SHA-256", root }` (§3) |

**Allowed media** (declarative only): PNG, JPEG, WebP, GIF, MP3, OGG, WAV, M4A, MP4, WebM, JSON,
plain text — each tied to its extensions. HTML, SVG, JavaScript, WASM and every executable or
native binary are refused (`DISALLOWED_MEDIA_TYPE`). The only experience entry format is
`space.content-index/v1`, a JSON list of `{ id, title, asset, kind }` rendered by the runtime; no
bundled code is ever executed.

**Authority is never declared.** Fields named `owner`, `owners`, `ownership`, `authority`,
`grants`, `delegation(s)`, `admin(s)`, `controller(s)`, `role(s)`, `acl(s)`, `bearer`,
`accessToken`, `authToken` or `digiAuthority` — anywhere in the manifest or in any JSON asset —
are refused with `AUTHORITY_CLONING_REJECTED`.

## 3. Integrity and signature

- **Asset hashes**: SHA-256 and exact size of every asset.
- **Integrity root**: SHA-256 of `canonicalJson` of the path-sorted inventory
  `[{ path, mediaType, size, sha256 }]` — the content identity, recorded in the manifest.
- **Signed bytes**: `"digiconomy.space-package/v1\n" + canonicalJson(manifest)`. `canonicalJson`
  is the canonicalization already shared by every signed Xperience artifact
  (`xperience-contract/release.ts`: recursively sorted keys, `JSON.stringify`). The domain prefix
  stops a package signature being replayed as any other signed artifact.
- **Signature** (`META-INF/signature.json`): `{ algorithm: "Ed25519", publisherId, keyId,
  manifestSha256, value }` — the same algorithm and key encodings (SPKI/PKCS#8, base64) as the
  signed catalog and Space Launch File V1. `manifestSha256` is the **package digest**: the
  identity of this exact package (content, version and declarations).

One signature covers everything: the manifest carries every asset hash and the root.

### Trust

Verification takes a list of pinned `TrustedPackagePublisher` entries
(`publisherId`, `keys[{ keyId, publicKeySpkiBase64 }]`, `packagePrefixes[]`). A publisher or key
not in the list is `PUBLISHER_UNKNOWN` — never verified against an embedded key, never elevated to
trusted, never installed. A trusted publisher may only sign packages under its own prefixes
(`PUBLISHER_NOT_AUTHORIZED`).

## 4. Operations

| Command | API | What it does |
|---|---|---|
| `space pack <dir> --key <signer.json> --out <file>` | `packSpace` | Builds and signs. Refuses private data, authority fields, disallowed media, unsafe paths and symlinks in the source folder. |
| `space inspect <file>` | `inspectSpacePackage` | Structure and declarations only; `trust: "NOT_EVALUATED"`. |
| `space verify <file> --publishers <trust.json>` | `verifySpacePackage` | Offline: structure → publisher trust → signature → every asset hash → integrity root → private data → runtime compatibility → dependencies. |
| `space import <file> --state <dir> --publishers <trust.json>` | `importSpacePackage` | Verifies, then installs transactionally. |
| `space list --state <dir>` | `listSpaces` | Installed Spaces. |
| `space open <id> --state <dir> [--online] [--route p] [--request p]` | `openSpace` | Loads into the canonical Space Runtime with enforced permissions. |

A pack source folder holds `space.source.json` (the declaration: everything except computed
fields) and `content/`. Exit codes: `0` ok, `2` rejected (JSON `{ rejected, error, detail }`),
`1` usage.

## 5. Installation and opening

- The package artifact is immutable; it is kept unchanged beside separate installation state:
  `installations/<packageId>/{package.space, installation.json, assets/…}`.
- Import stages into `.staging/<uuid>/` and commits with a single directory rename — an
  installation is complete or absent. A failure rolls back what that import wrote
  (`IMPORT_INTERRUPTED`); a crash's leftovers are discarded by `recover()` before the next import.
- The installation record carries `authority: { owner: null, grants: [] }` and a fresh local
  `installationId`. When opened, the Space contract's `owner` is `installation:<installationId>`
  — never the publisher.
- Re-importing the same package digest is idempotent (`ALREADY_INSTALLED`, same installation).
  A different package under an installed id is `INSTALLED_VERSION_CONFLICT` (updates are SP2).
- Opening re-hashes every asset it uses (`INSTALLATION_CORRUPT` if modified on disk), builds the
  `SpaceDefinition`, creates its runtime state with `createSpaceRuntime`, and resolves the
  experience's required permissions through `space-capability-bridge`.

| Permission | Scope | Available when |
|---|---|---|
| `content.read`, `media.playback`, `storage.local` | LOCAL | the runtime implements it |
| `network.sync`, `settlement.request` | REMOTE | online **and** a valid, authorized route exists |

A permission is granted only if the package declares it **and** the runtime can provide it now.
Undeclared permissions are never granted, whatever the runtime offers. A required permission
that is unavailable blocks the experience. Offline, remote permissions are `UNAVAILABLE`
(`OFFLINE`); online without a route, `NO_VALID_ROUTE`.

## 6. What a package never contains

Refused on pack **and** on verify (a hand-built package is still caught): private keys (PEM),
JWT/bearer tokens, cookies, JSON fields for session/access/refresh/ID tokens, API or client
secrets, passwords/PINs, biometric material (face embeddings, fingerprint or TrustID templates),
PDI records, Digi Authority grants or tokens, payment data (card numbers, CVV, IBAN, account
numbers), device secrets and seed phrases, and files such as `.env`, `*.pem`, `*.key`, `*.p12`,
keystores and cookie jars → `PRIVATE_DATA_DETECTED`. Binary media is checked by name; text and
JSON by content.

## 7. Example (the demonstration Space)

`examples/space-package/lantern` → 8,227-byte package:

```
mimetype                  40 B  STORED
META-INF/space.json    1,565 B  STORED
META-INF/signature.json  259 B  STORED
content/index.json       295 B  STORED   space.content-index/v1
content/media/chime.wav 4,044 B STORED   audio/wav
content/media/lantern.png 1,314 B STORED image/png
integrity root c96ca7db55c4c6f3371804a244408af0691f7309d8104d7f43fe9306fc9aaee8
```

```json
{
  "format": "digiconomy.space-package", "formatVersion": 1,
  "package": { "id": "org.digiconomy.demo.lantern", "version": "1.0.0", "name": "Lantern Demo Space" },
  "publisher": { "publisherId": "digiconomy.demo", "keyId": "demo-key-1" },
  "runtime": { "spaceContractVersion": 1, "minimumRuntimeVersion": "1.0.0" },
  "space": { "spaceId": "org.digiconomy.demo.lantern", "defaultExperienceId": "gallery",
    "experiences": [{ "id": "gallery", "title": "Lantern Gallery", "type": "gallery",
      "entry": { "type": "space.content-index/v1", "path": "content/index.json" },
      "offlinePolicy": "cached", "requires": ["content.read", "media.playback"] }] },
  "assets": [
    { "path": "content/index.json", "mediaType": "application/json", "size": 295, "sha256": "16014059…" },
    { "path": "content/media/chime.wav", "mediaType": "audio/wav", "size": 4044, "sha256": "8441455f…" },
    { "path": "content/media/lantern.png", "mediaType": "image/png", "size": 1314, "sha256": "94982a09…" }],
  "offline": { "capabilities": ["space.gallery"], "contentIndex": "content/index.json" },
  "permissions": ["content.read", "media.playback", "network.sync"],
  "dependencies": [],
  "license": { "spdx": "CC0-1.0", "duplication": "ALLOWED", "redistribution": true },
  "provenance": { "createdAt": "2026-10-09T00:00:00.000Z", "tool": "space-package/1.0.0" },
  "integrity": { "algorithm": "SHA-256", "root": "c96ca7db…" }
}
```

Demo keys are generated per run and never committed.

## 8. Boundaries

- Reuses `space-runtime` (`SpaceDefinition`, `createSpaceRuntime`), `space-capability-bridge`
  (`CapabilityRegistry`, `resolveExperienceCapabilities`) and `xperience-contract`
  (`canonicalJson`) unchanged.
- Does not modify Space Launch File V1, Space Installation V1, the Offline Kernel, OS Xperience or
  the Master Distributor (a separate repository that may later distribute packages as artifacts).
- Does not implement or duplicate TrustID, PDI, DataZone or Digi Authority; it only refuses their
  data and never transfers authority.

## 9. Not in SP1

- **SP2** — updates: a newer signed version of an installed package, migrating local state, keeping
  the previous version until the new one is verified; key rotation and revocation lists.
- **SP3** — distribution: Master Distributor publishing and signed catalogs of packages; the OS
  Xperience UI (import from a file, open from Home); browser storage for installations.
- **SP4** — peer-to-peer transfer between devices (nearby share), richer sandboxed experience formats
  beyond the content index, and per-installation local state export that excludes private data.
