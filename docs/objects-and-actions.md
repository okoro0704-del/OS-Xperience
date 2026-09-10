# Objects and Actions (OS Shell 1.5)

OS Shell 1.5 introduces the **Universal Object & Action** coordination layer.

Protocol remains `os-shell / 0.7`. Object/action contract: `1.5`.

## Core boundaries

```
Object Reference ≠ Object Ownership
Action Declaration ≠ Action Authorization
Action Availability ≠ Capability Grant
Action Selection ≠ Action Execution
```

The Shell coordinates. Applications execute. Infrastructure owns resources.

## Object references

Objects reuse the existing context vocabulary:

```
asset · document · media · project · file · text · url · application · digital_life
```

Optional display fields: `title`, `subtype`, `mimeType`, `originAppId`.

There is **no** universal object database:

```
shell.objects.get()   // forbidden
shell.objects.list()  // forbidden
shell.objects.search() // forbidden
```

## Actions

Actions reuse the intent vocabulary:

```
open · view · edit · create · share · import · export · publish
```

Relationship:

```
Action (user-facing)
  ↓
Intent (routing)
  ↓
Application handler
  ↓
Application execution
```

## Discovery

```ts
shell.actions.discover({ object })
```

Returns action + handler + availability:

```
AVAILABLE
UNAVAILABLE
PERMISSION_REQUIRED
INCOMPATIBLE
NOT_CONNECTED
```

Handler existence alone does not mean the action is executable.

## Request

```ts
shell.actions.request({ action, object, targetAppId?, sessionId? })
```

Passes only:

- object reference
- action/intent
- optional session participation

Never bytes, credentials, tokens, balances, or private application state.

## Current context

```ts
shell.context.current()
shell.context.select(object)
```

Reference-only. Selection does not grant access. Default disclosure is current context only.

## Defaults

Default handlers remain user-controlled, revocable, and scoped to action/object type. They do not inherit authority.

## Confirmation

Consequential actions such as `publish` and `export` may require Shell confirmation before routing. The application still owns domain execution and confirmation.

## Security doctrine

```
Object ≠ authorization
Action ≠ capability
Handler ≠ privilege
Session ≠ authentication
Trust ≠ unlimited access
```

## Standalone

Outside Shell, action and context APIs return `shell_unavailable`. Applications remain usable as websites.

## No new primitive / backend

No action-engine, object-engine, search-engine, workflow-engine, Redis, Postgres, or WebSocket action server.
