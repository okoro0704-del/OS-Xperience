# OS Shell Developer Contract (1.1)

OS Shell is a thin operating surface and policy mediator. Applications own execution. Primitives own infrastructure.

Package version: `2.0.0`. Protocol: `channel: "os-shell"`, `version: "0.7"`. Developer contract: `1.3`. See also [application-distribution.md](application-distribution.md), [interoperability.md](interoperability.md), [sessions-and-continuity.md](sessions-and-continuity.md), [objects-and-actions.md](objects-and-actions.md), [search-and-discovery.md](search-and-discovery.md), [objectives-and-workflows.md](objectives-and-workflows.md), [preferences-and-routing.md](preferences-and-routing.md), [cross-application-continuity.md](cross-application-continuity.md), and [personal-operating-context.md](personal-operating-context.md).

## Quick start

1. Build a normal web application.
2. Add `/.well-known/os-shell.json` (or use the public developer manifest shape).
3. Declare `requestedCapabilities`.
4. Optionally depend on `@osshell/sdk`.
5. Open the app inside OS Shell.
6. Call `shell.capabilities.list()` / `shell.capabilities.request("camera")`.
7. Execute the capability inside your application.
8. Handle denial and unavailability honestly.
9. Outside Shell, keep working as a standalone website (`shell.isAvailable === false`).

You do **not** need Trust ID, FundzMan, Sovereign Drive, Platform Jobs, Master Distributor, LifeOS, or mybrandOS source code.

## Application lifecycle

```
OPEN → ACTIVE → BACKGROUND | SUSPENDED → CLOSED
```

Send `application.ready`, `application.navigation`, `application.title`, and `application.lifecycle` when hosted in Shell.

## Trust classes

| Class | Meaning |
| --- | --- |
| Class A (`web`) | Ordinary website. Capabilities blocked. |
| Compatible | Shell-aware origin. Mediation allowed per policy. |
| Native | Explicit first-party origin. Trusted, **not** unlimited. |

Declared `class: "native"` from an untrusted origin becomes compatible / `native_unverified`. Origin policy is authoritative.

## Application trust states

```
UNREGISTERED → REGISTERED → VERIFIED → FIRST_PARTY
```

Registration does **not** equal privilege. Verified ≠ unlimited.

## Capability states

```
available
permission_required
granted
denied
unavailable
class_a_blocked
```

`GRANTED` means the Shell authorized the request. It does **not** mean the operation succeeded. Your app still executes.

## Public capabilities

`identity` · `assets` · `camera` · `commerce` · `device_bridge` · `live`

Discovery describes what you may request, not how Digiconomy implements it.

## Permission behavior

- The Shell prompts only on an explicit capability request when no grant exists.
- Grants persist per `origin + capability`.
- Revoke removes future authorization; it does not seize an existing browser MediaStream.
- Denial and unavailability remain distinct.
- Applications cannot inspect or inherit each other’s grants.

## Errors

| Code | Meaning |
| --- | --- |
| `shell_unavailable` | Not hosted in OS Shell |
| `manifest_invalid` | Manifest failed validation |
| `origin_unverified` / `origin_mismatch` | Origin problem |
| `capability_unknown` | Unknown capability id |
| `capability_denied` | User/policy denial |
| `capability_unavailable` | Provider/infrastructure not ready |
| `class_a_blocked` | Ordinary web class |
| `permission_required` | Needs user grant |
| `application_not_registered` | No registered session |
| `application_not_verified` | Trust gate (when used) |

## Simulation

`DEVELOPMENT / SIMULATION ONLY` on localhost Shell hosts. Tests Shell contract outcomes. Never creates tokens, balances, identity assertions, or device handles. Must not silently affect production authorization.

Opt in on the Shell host (`http://127.0.0.1` / `localhost` only) via `localStorage`:

```js
localStorage.setItem("os-shell.simulation", JSON.stringify({
  enabled: true,
  scenarios: { camera: "denied" } // granted | denied | unavailable | permission_required | class_a_blocked
}))
```

## Security

Authority comes from `event.origin`, `event.source`, and registration — never from payload identity fields. Privileged `postMessage` never uses `*`. Credential-bearing payloads are rejected.

## Example

See `apps/demo-notes` — Shell Demo Notes. It works standalone and inside Shell, requests camera after mediation, and never imports Digiconomy internals.
