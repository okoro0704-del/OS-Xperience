# OS Shell Interoperability Contract (1.3)

OS Shell coordinates **typed intents** and **context references** between applications.

It does **not** own application data, files, assets, identity, or money.

Package: `1.3.0`. Protocol: `os-shell` / `0.7`. Interoperability contract: `1.3`.

## Model

```
Human
  → OS Shell
  → Intent
  → Typed context reference
  → User-approved handler
  → Target application
```

## Rules

```
intent ≠ capability
context ≠ permission
handoff ≠ credential delegation
reference ≠ authorization
```

## Intents

`open` · `view` · `edit` · `create` · `share` · `import` · `export` · `publish`

## Context types

`asset` · `document` · `media` · `project` · `application` · `digital_life` · `url` · `text` · `file`

Default lifetime: **EPHEMERAL**.

Context may include opaque ids, titles, mime types, small text, URLs, and shallow metadata.
It must never include tokens, credentials, raw bytes, or private storage credentials.

## Manifest

Optional:

```json
{
  "intentHandlers": [
    { "intent": "view", "contextTypes": ["text"], "route": "/" }
  ]
}
```

Older manifests without handlers remain valid.

## SDK

```ts
const shell = getOSShellContext({ onIntent: (delivery) => { /* typed reference only */ } })

const handlers = await shell.intents.discover({ intent: "view", contextType: "text" })

const context = shell.context.create({ type: "text", text: "Hello", lifetime: "EPHEMERAL" })

const result = await shell.intents.request({ intent: "share", context: context.context })
```

Outside Shell: `shell.isAvailable === false` and apps degrade gracefully.

## Routing

1. Source app requests an intent with typed context.
2. Shell derives `sourceAppId` from the authenticated connection.
3. Shell discovers handlers from installed apps.
4. Explicit target, default handler, or user chooser selects the target.
5. Shell opens the target via the existing safe handoff path.
6. Target receives `intent.deliver` with the typed reference only.

Defaults are revocable and are **not** permissions.

## Digital Life

`digitallife.context` remains least-privilege presence.
Asset references do not automatically expose private bytes.

## What this phase does not build

Interoperability backend · message broker · context database · marketplace · Store · seventh primitive.
