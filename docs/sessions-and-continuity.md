# Sessions and Continuity (OS Shell 1.4)

OS Shell sessions preserve the user's **operating place** while they move between applications.

They do **not** become an application database, identity provider, or analytics layer.

Protocol remains `os-shell / 0.7`. Continuity contract: `1.4`.

## What a Shell session is

A session is Shell-owned coordination metadata:

- which application is active
- which context reference is in play
- which applications participated in this workflow
- where the user can return
- optional resume points (references + labels only)

## What a Shell session is not

```
Session ≠ authentication
Session ≠ authorization
Session ≠ application database
Session ≠ Digital Life database
Session ≠ payment state
```

Also:

- Session ≠ permission inheritance
- Session ≠ credential or token transfer
- Continuity ≠ data ownership

## Lifecycle

```
CREATED → ACTIVE → BACKGROUND | SUSPENDED → ENDED
```

Lifecycle is **client-side only**. There is no session server, Redis, Postgres, or WebSocket session engine.

Default persistence is **session-only** (tab-local via `sessionStorage`). Optional **resume-safe** metadata may survive reload for a recovery prompt. It never stores private application payloads.

Each Shell tab owns its own local sessions. There is no distributed multi-tab sync.

## Context

Session context stores **references**, not bytes:

- context type + opaque id / title / url / text snippet limits from the interoperability contract
- never files, balances, tokens, credentials, Digital Life graphs, or private project state

Ephemeral by default. When a session ends, session-only references are cleared.

If a referenced object is gone:

```
context_unavailable
```

The Shell shows that the item is no longer available. It does not invent a replacement.

## Resume

Applications may declare:

```ts
resumeSupport: { supported: boolean }
```

and optionally expose a public resume descriptor:

```ts
{ label: string; route?: string; context?: OSShellContextReference }
```

The Shell may offer **Open / Resume / Start Fresh**.

If restoration is impossible:

```
resume_unavailable
```

The Shell never fabricates application editor state.

## Intent participation

Intents may include optional `sessionId`. The Shell derives source application identity from the connected origin. Caller-supplied identity is not trusted.

On handoff the Shell preserves:

- sessionId
- source application
- target application
- intent
- context **reference** (not private payload)

The target learns session participation and context type. It does **not** receive source permissions, credentials, grants, or private state.

## Return path

Return uses the existing navigation precedence:

```
Application history
    ↓
Shell history
    ↓
Browser history
```

Sessions coordinate with this model. They do not replace it.

## Participants

A lightweight participant list records `appId` + timestamps. First-party and external applications participate under the same rules.

## Security

Rejected:

- unknown / forged session IDs
- unauthorized foreign-session inspection
- secret payloads in session context
- permission inheritance via session
- credential / token injection

Session membership is mediated by the Shell from authenticated connections.

## Privacy

Default disclosure is minimal. Participating in a handoff does **not** grant the target the full prior workflow history.

Diagnostics/audit may record:

```
session_created
session_activated
session_switched
session_joined
session_left
session_resumed
session_ended
intent_started
intent_completed
```

Never private payloads.

## Public SDK

```ts
shell.session.current()
shell.session.create()
shell.session.resume(sessionId)
shell.session.end(sessionId?)
shell.session.join(sessionId)
shell.session.leave(sessionId?)
```

Outside Shell:

```ts
shell.isAvailable === false
// session APIs return shell_unavailable
```

Session-unaware applications continue to work.

## Standalone browser

Applications remain usable as ordinary websites. Session APIs degrade gracefully. No Shell backend is required.

## Architecture boundary

```
OS SHELL
   ├── Application Contract (intents)
   └── Session Context (continuity)
            ↓
   Application Execution
            ↓
   Existing Infrastructure
```

Six primitives unchanged. No seventh `session-engine` primitive.
