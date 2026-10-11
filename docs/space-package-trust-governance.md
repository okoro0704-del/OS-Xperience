# Digiconomy Space Packages — Production Trust Governance (required model)

Status: **requirements, not yet provisioned.** No production key exists in this repository and none may
be generated or embedded by tooling. The only keys anywhere in the code are the synthetic Lantern test
keys, generated in memory per test run (`packages/space-package/test/*helpers.ts`,
`api/test/space-installer-harness.ts`) and never written to the app, a build or a device.

This document states who must hold which authority before Space packages can be trusted on real
devices. It uses only the mechanisms frozen in SP1/SP2 (`docs/space-package-v1.md`,
`docs/space-package-v2.md` §6). Where SP1/SP2 provide no mechanism, the gap is named, not invented.

## 1. Roles

| Role | Holds | May do | May never do |
|---|---|---|---|
| **Root trust authority** (Digiconomy) | one or more `authorities[]` keys (SP2 `TrustAuthority`) | authorize publisher key rotations and revocations on a publisher's behalf (SP2 `authorizedBy: { authorityId, keyId }`), including emergency revocation | sign packages or update documents; grant owner or authority over an installation |
| **Publisher** | publisher signing keys (ACTIVE / ROTATING) | sign packages, update documents, its own key rotations and revocation lists, and lineage transitions | sign for another publisher; publish outside its `packagePrefixes` |
| **Device** (OS Xperience) | public keys only | verify; apply signed statements; report revocation freshness | trust a key or publisher because of a UI choice, a file's origin, or a network location |

Installing a package never confers owner or authority on anyone (SP1/SP2 `authority: { owner: null, grants: [] }`).

## 2. Root trust anchors

- The root authority keys are the device's trust anchors. They are delivered **only** inside a signed
  OS Xperience build (web build and Capacitor bundle) as `bundledTrust`, never fetched, typed or
  pasted at run time.
- Held offline (HSM or offline ceremony machine), with at least two keys so one can revoke/replace
  the other; access needs two people. Private material never enters CI, this repository, or a device.
- Anchor changes ship as a new signed app release with release notes and a recorded ceremony.

## 3. Publisher enrollment

Required process (organizational; there is no runtime "trust this publisher" action, by design):

1. The publisher proves identity and control of its `publisherId` namespace to Digiconomy.
2. Digiconomy assigns `packagePrefixes` (the package ids the publisher may sign).
3. The publisher generates its key pair on its own infrastructure and submits **only** the public key
   (`space keys` tooling never transports private keys).
4. The enrolled record (`publisherId`, name, keys, prefixes) is reviewed by two people and added to the
   bundled trust of the next signed app release.

**Gap (blocks production enrollment after first install):** SP2 has signed statements for rotation,
revocation and lineage transition, but **no signed enrollment statement**. SP3's runtime uses the
device's stored trust when one exists and ignores the bundled set, so a publisher enrolled in a later
app release does not reach devices that already hold a trust store. Before a second publisher is
enrolled, the authority must approve one of: (a) a signed, root-authorized enrollment statement in
the SP2 statement format, or (b) a defined merge rule for bundled anchors (add-only, never
un-revoke, never lower a sequence). Neither is implemented; choosing one is a trust-policy decision.

## 4. Publisher signing keys

- Ed25519 only (SP1). One ACTIVE key per publisher in normal operation.
- Private keys stay in the publisher's HSM/KMS or offline signer; signing happens there.
- Package signatures cover the canonical manifest (`digiconomy.space-package/v1`); update documents
  carry the target digest and sequence, so a key can never "re-sign" older bytes into a newer release.

## 5. Key rotation (SP2 `digiconomy.space-key-rotation`)

- Signed by the publisher's **ACTIVE** key (or a root authority key), strictly increasing sequence.
- New key → ACTIVE; old key → ROTATING (still accepted for updates during the window, cannot chain
  further rotations). Completing the rotation retires the old key (RETIRED: verifies what it signed,
  signs nothing new).
- Schedule: at least yearly and on any staff or infrastructure change. Rotation statements are
  distributed exactly like revocation lists (§7).

## 6. Revocation-list signing (SP2 `digiconomy.space-key-revocations`)

- Signed by an ACTIVE/ROTATING publisher key **or** a root authority key; sequence strictly increases
  (`REVOCATION_REPLAY` otherwise). Revocation is terminal; a revoked key id can never be re-added.
- The publisher issues a new list on every revocation **and** on a fixed heartbeat (at most every 24 h,
  possibly with no new entries), so devices can prove freshness.
- The root authority keeps the ability to issue lists for any publisher (compromise, unresponsive
  publisher).

## 7. Revocation distribution and freshness

- SP2 accepts lists from any channel because the list itself is signed; distribution is not trusted.
- **Gap:** no distribution channel exists yet. Today lists reach a device only as a file (SP3 trust
  statement intake). Required before production: a fetch of the latest signed list per publisher
  (CDN or Xperience API) when online, plus inclusion of current lists in Space update bundles.
- Freshness is reported, never assumed (`CURRENT` / `STALE` / `UNKNOWN`, default window 7 days, local
  clock). Security-sensitive updates must use `requiresRevocationSequence` (clock-independent) and/or
  `requiresCurrentRevocation`, which fail closed offline.
- Policy: publishers mark an update security-sensitive whenever it fixes a vulnerability or follows a
  key event.

## 8. Emergency key compromise

1. **Within 1 hour:** the root authority (or the publisher's surviving ACTIVE key) signs a revocation
   list revoking the compromised key id; it is published on every distribution path in §7.
2. Devices that receive it refuse new installs, updates and rollbacks signed by that key
   (`KEY_REVOKED`); releases it signed stop verifying.
3. The publisher (via the root authority if it lost its only key) introduces a replacement key with a
   rotation statement authorized by the root authority, then re-signs the current release and
   ships it as a normal signed update with `requiresRevocationSequence` set to the emergency list's
   sequence, so it cannot be applied on a device that has not seen the revocation.
4. Devices that never receive the list cannot know about it; this is shown as STALE/UNKNOWN freshness,
   not hidden (SP2 §10).
5. Compromise of a **root authority** key: revoke via the second authority key and ship a new app
   release with replacement anchors; until then devices keep the old anchors (documented residual risk).

## 9. Test keys

- Synthetic Lantern publisher `digiconomy.demo` (keys `demo-key-1`, `demo-key-2`) exists only in tests,
  generated in memory each run. It must never be added to `bundledTrust`; a production build ships
  with an empty trust store until §2–§4 are executed, so a device trusts no publisher at all.
