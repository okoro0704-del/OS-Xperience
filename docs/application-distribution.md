# OS Shell Application Distribution Contract (1.2)

OS Shell 1.2 is the application ecosystem layer above the 1.1 developer contract.

It is **not** an app store, marketplace, billing system, or backend.

Package: `1.2.0`. Protocol: `os-shell` / `0.7`. Developer + distribution contract: `1.2`.

## Flow

```
Web Application
    → Manifest
    → Register / Install (local registry)
    → Launch
    → capability.request
    → Update metadata (optional)
    → Remove
```

## Identity

Stable `appId` across versions. Origin is security authority.

```
same appId + same origin + new version  → identity preserved
same appId + different origin           → explicit origin-change handling; grants are NOT transferred
```

## Presence vs trust vs privilege

```
DISCOVERED → REGISTERED → INSTALLED → RUNNING
```

```
UNREGISTERED | REGISTERED | VERIFIED | FIRST_PARTY
```

```
source: FIRST_PARTY | DEVELOPER | LOCAL | EXTERNAL
```

These are independent. Installed ≠ trusted. Verified ≠ privileged.

## Install

1. Provide an origin.
2. Shell loads `/.well-known/os-shell.json`.
3. Manifest + origin are validated.
4. User sees name, origin, version, trust, requested capabilities, source.
5. Confirm installs into the **local client registry**.
6. **No capabilities are granted by install.**

## Remove

Removes Shell’s relationship with the application:

- registry entry
- launcher entry
- application-scoped grants

Does not delete the website, remote accounts, or application-owned data.

## Updates

Update metadata only. No package repository.

Statuses: `current` | `update_available` | `unknown` | `unavailable`.

Localhost may simulate an available version for contract testing.

## Compatibility

Applications can negotiate Shell protocol / contract version. Incompatible apps fail with `application_incompatible`.

## Deep links

```
application://{appId}/path
```

Resolves to a known installed application + application-owned route. Apps validate their own parameters.

## Handoff

```
shell.handoff({ targetAppId, route?, context? })
```

Navigation/context only. Never transfers grants, tokens, credentials, balances, or privileged handles.

## First-party parity

LifeOS, mybrandOS, and Shell Demo Notes participate through the same registry model. Differences are origin, source, trust, and grants — not internal privilege APIs.

## What this phase does not build

Store · marketplace · ratings · recommendations · subscriptions · developer billing · Shell backend · seventh primitive.
