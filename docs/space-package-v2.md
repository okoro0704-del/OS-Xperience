# Digiconomy Space Package — SP2: Lifecycle

Signed updates, local-state continuity, publisher key rotation and revocation, and rollback, on top of
the SP1 package format (`docs/space-package-v1.md`, unchanged). Implementation:
`packages/space-package/src/{trust,update,state,backend,node-backend,lifecycle,fork,cli-lifecycle}.ts`.

## 1. Identities

| Identity | What it names | Where |
|---|---|---|
| Package ID | a lineage of releases | `manifest.package.id`, `update.lineage.packageId` |
| Package digest | immutable package bytes (SHA-256 of the signed manifest) | SP1 `signature.manifestSha256` |
| Version | a release within the lineage; immutable once seen | `manifest.package.version`; per-installation `ledger` |
| Release sequence | the publisher's strictly increasing release order (anti-downgrade) | signed `update.from/to.sequence` |
| Publisher identity | who may sign the lineage | `publisherId` + trusted key |
| Installation ID | one local installation | `record.installationId` — kept by every update |
| State ID | the local state of that installation | `record.stateId`, `state.stateId` — kept by every update |

A new installation (or a fork) never inherits another's installation ID, state, owner or authority:
`authority` is always `{ owner: null, grants: [] }`.

## 2. Signed update document

Published beside the target package. Signed bytes: `"digiconomy.space-update/v1\n" + canonicalJson(body)`, Ed25519.

| Field | Binds |
|---|---|
| `lineage.packageId` | the lineage |
| `publisher` `{ publisherId, keyId }` | the signing authority |
| `from` / `to` `{ version, packageDigest, sequence }` | exact previous and target releases; `to.sequence > from.sequence` |
| `compatibility` | must equal the target manifest's `runtime` |
| `permissions` | must equal the target manifest's permissions |
| `state` `{ fromDataVersion, toDataVersion, migration[], backwardCompatible }` | the state migration |
| `rollback` `{ eligible, minimumSequence }` | rollback eligibility and the security floor it sets |
| `security` `{ requiresRevocationSequence, requiresCurrentRevocation }` | fail-closed revocation requirements |
| `issuedAt` | informational only — never used for ordering or trust |

Owner/authority fields anywhere in the document are refused (`AUTHORITY_CLONING_REJECTED`).

## 3. Update engine

```
AVAILABLE → DOWNLOADING → STAGED → VERIFIED → MIGRATION_PREPARED → ACTIVATING → ACTIVE
failures:   REJECTED · INTERRUPTED · ROLLED_BACK · RECOVERY_REQUIRED
```

- Every transition is written to a durable transaction record (`journal/<txId>.json`) before it takes effect.
- **STAGED** — bytes held in `.staging/<txId>/`, apart from every installation.
- **VERIFIED** — in order: lineage; publisher (changes only through a signed transition); signing key ACTIVE/ROTATING (REVOKED → `KEY_REVOKED`, RETIRED/unknown → `KEY_NOT_AUTHORIZED`); update signature; revocation requirements; `from` equals the installed release; `to.sequence` above the installed sequence and the security floor (`DOWNGRADE_REJECTED`); version not reused with other bytes (`VERSION_REUSED`); state data version; the full SP1 package verification against non-revoked keys; package digest equals `to.packageDigest`; compatibility and permissions match; added permissions explicitly approved (`PERMISSION_ESCALATION`).
- **MIGRATION_PREPARED** — the state lock is taken (state writes return `STATE_LOCKED`), the current state is snapshotted, and the migrated state is written beside it. Nothing is replaced.
- **ACTIVATING** — the staged bytes are re-verified, the release is moved into `releases/<digest>/` (inactive), then **one commit point**: the atomic write of the installation record naming the new release. Afterwards the migrated state is promoted (atomic rename), the lock released, and the release two steps back removed. The previous release is kept until the new one is proven (first successful open) and superseded.

### Recovery (deterministic, idempotent; runs before every operation)

| Found | Outcome |
|---|---|
| DOWNLOADING / AVAILABLE | INTERRUPTED; partial bytes discarded |
| STAGED / VERIFIED / MIGRATION_PREPARED, consistent | kept (durable, resumable); a half-taken lock or partial state is undone |
| ACTIVATING, record not committed | INTERRUPTED; the previous release stays active; the partial release is removed |
| ACTIVATING, record committed | completed to ACTIVE (state promoted, lock released) |
| orphaned staging | discarded |

A partially installed release can never become active. Running recovery again changes nothing.

## 4. Local state

`state/current.json`, schema `digiconomy.space-state/v1`: `preferences`, `settings`, `playlists`,
`userContent` (references), `pendingOperations`, `journal` (append-only, contiguous), `runtime`
(the Space Runtime snapshot), plus `stateId`, `installationId`, `packageId`, `dataVersion`, `revision`.

- Writes go through `writeState` only: identity and data version are fixed; every write is scanned and
  refused (`SENSITIVE_STATE_REJECTED`) if it carries TrustID sessions, Digi Authority grants, private keys,
  payment data, biometric material, device secrets, tokens, or owner/authority fields.
- Migrations are declarative and deterministic (`renamePreference`, `setPreferenceDefault`,
  `removePreference`, `renameSetting`, `setSettingDefault`, `renameContentItem`, `removeContentItem`);
  they never touch user content, pending operations or the journal; re-running gives the same result.
- Pending operations are records: adding the same `opId` twice is a no-op. After a rollback, restore
  or recovery, consequential operations still PENDING become **HELD** and need explicit
  re-confirmation — they are never replayed automatically; DONE stays DONE.

## 5. Rollback

`rollback` returns to the last known-good release **with the current state** (never an older copy, so
user content created since is kept and operations are not duplicated). It is refused:
not rollback-eligible (`ROLLBACK_NOT_ELIGIBLE`); below the security floor (`BELOW_SECURITY_FLOOR`);
to a release signed by a revoked key (`KEY_REVOKED` — revocation is never undone). If the previous release
cannot read the migrated state (`dataVersion` higher and `backwardCompatible: false`) or no longer
verifies, nothing changes and the result is **RECOVERY_REQUIRED**; with `--launch-failed` the
installation is also marked RECOVERY_REQUIRED and refuses to open until resolved. Data is never deleted.

## 6. Publisher trust and keys

Trust store (`digiconomy.space-trust/v1`, persisted JSON, public keys only): publishers with keys,
per-publisher `trustSequence`, revoked key ids, revocation evidence `{ sequence, issuedAt, receivedAt }`,
separately established `authorities`, and signed publisher `transitions`; `policyVersion` 1.

```
ACTIVE ──rotate──▶ ROTATING ──complete──▶ RETIRED        REVOKED (terminal, from any state)
```

| State | New updates | Releases it already signed |
|---|---|---|
| ACTIVE | signs, authorizes rotations and revocations | verify |
| ROTATING | still accepted during the window; cannot authorize rotations | verify |
| RETIRED | refused | verify (installed and previous releases keep working) |
| REVOKED | refused | refused (no rollback to them; the key id can never be re-added) |

- **Rotation** (`digiconomy.space-key-rotation`): signed by a trusted ACTIVE key of the publisher (or an
  authority), strictly increasing sequence; adds the new key ACTIVE, moves the retiring key to ROTATING.
  An unknown key never becomes trusted on its own. Completing a rotation (→ RETIRED) removes trust and
  needs no signature.
- **Revocation** (`digiconomy.space-key-revocations`): signed by an ACTIVE/ROTATING key or an authority;
  sequence must strictly increase (`REVOCATION_REPLAY`); revocation is terminal.
- **Freshness offline** is reported, never assumed: `CURRENT` (evidence obtained within the policy
  window), `STALE`, or `UNKNOWN`. A signature check reports `VALID_AGAINST_LOCAL_TRUST`, separately.
  Security-sensitive updates fail closed (`FRESH_REVOCATION_REQUIRED`) when they require a minimum
  revocation sequence this device does not hold (clock-independent) or CURRENT evidence it does not have.
- **Publisher transition** (`digiconomy.space-publisher-transition`): a lineage moves to another trusted
  publisher only with a statement signed by the current publisher's ACTIVE key.

## 7. Copy, install, update, fork

| | Identity | State | Authority |
|---|---|---|---|
| COPY | same package digest | — | — |
| INSTALL | new installation ID and state ID | empty | none |
| UPDATE | same installation ID and state ID | kept and migrated | none |
| FORK | new package ID (lineage), `provenance.parent`, the forker's own publisher | separate installation | none |

`forkSpace` requires the parent licence to allow it (`redistribution: true`, `duplication: "ALLOWED"`,
else `FORK_NOT_PERMITTED`), a new package id, and a different publisher. A fork can never be applied as
an update to its parent. Possessing a file is never ownership.

## 8. CLI

```
space install  <file.space> --state <dir> --trust <trust.json>
space status   <package-id> --state <dir> --trust <trust.json>
space launch   <package-id> --state <dir> --trust <trust.json> [--online] [--route p]… [--request p]…
space state show  <package-id> --state <dir> --trust <trust.json>
space state merge <package-id> <patch.json> --state <dir> --trust <trust.json>

space update create   --from <old.space> --to <new.space> --key <signer.json> --from-sequence <n> --to-sequence <m>
                      [--migration <migration.json>] [--no-rollback] [--security-floor <n>]
                      [--requires-revocation <n>] [--requires-current-revocation] --out <update.json>
space update inspect  <update.json> [<new.space>] --state <dir> --trust <trust.json> [--approve p]…
space update stage    <update.json> <new.space> --state <dir> --trust <trust.json>
space update verify   <package-id> <tx-id> --state <dir> --trust <trust.json> [--approve p]…
space update activate <package-id> <tx-id> --state <dir> --trust <trust.json>
space update abort    <package-id> <tx-id> --state <dir> --trust <trust.json>
space update rollback <package-id> --state <dir> --trust <trust.json> [--reason <text>] [--launch-failed]
space update history  <package-id> --state <dir> --trust <trust.json>

space keys init            --publishers <publishers.json> --out <trust.json>
space keys inspect         --trust <trust.json> [--max-age-days <n>]
space keys sign-rotation   --key <signer.json> --retire <key-id> --new-key-id <id> --new-public <spki> --sequence <n> --out <rotation.json>
space keys rotate          --trust <trust.json> --statement <rotation.json> | --complete <publisher-id>
space keys sign-revocation --key <signer.json> --revoke <key-id>… --sequence <n> --out <revocations.json>
space keys revoke          --trust <trust.json> --list <revocations.json>
```

Signing commands read a private key from a file, use it in memory and never print, log or write it.
SP1 commands (`pack`, `inspect`, `verify`, `import`, `list`, `open`) are unchanged.

## 9. Storage layout

```
<state>/installations/<packageId>/record.json                    installation record (atomic replace)
<state>/installations/<packageId>/releases/<digest>/package.space  immutable verified artifact
<state>/installations/<packageId>/releases/<digest>/assets/…       verified assets (re-hashed on open)
<state>/installations/<packageId>/state/{current,next-<tx>,snapshot-<tx>}.json
<state>/installations/<packageId>/journal/<txId>.json             update transactions
<state>/.staging/<txId>/                                          downloads and release builds in progress
```

## 10. Limitations

- Revocation evidence is obtained out of band (`keys revoke` with a signed list); there is no network
  fetch or distribution channel for lists yet (SP3), so offline devices honestly report STALE/UNKNOWN.
- Freshness windows use the local clock for "obtained when"; the clock-independent control is the
  signed minimum revocation sequence an update can require.
- The lifecycle layout (`record.json`, `releases/`) is new in SP2; installations made with the SP1
  `FileInstallationStore` layout are not migrated (SP1 was never released).
- Directory renames are atomic on one volume; a state directory spread across volumes is unsupported.
- Migrations are a fixed declarative set; arbitrary migration code is deliberately not supported.
- Key compromise between verification and activation is caught by re-verification at activation, but a
  device that never receives the revocation cannot know about it (reported as freshness, not hidden).
