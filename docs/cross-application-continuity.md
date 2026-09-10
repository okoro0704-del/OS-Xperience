# Cross-Application Continuity (OS Shell 1.9)

OS Shell 1.9 introduces the **Operating Context Plane**.

Protocol remains `os-shell / 0.7`. Operating context contract: `1.9`.

Session continuity (1.4) remains separate and is reused — 1.9 does not invent a second session system.

## Core principle

```
The Shell remembers the user's place.
It should not remember everything the applications know.
```

```
Context ≠ Permission
Reference ≠ Authorization
Handoff ≠ Credential Delegation
Session ≠ Authentication
Objective ≠ Workflow
Preference ≠ Authorization
Application State ≠ Shell State
```

## Architecture position

```
HUMAN
↓
OBJECTIVE
↓
OS SHELL
  Discovery
  Routing
  Preference
  Continuity
↓
OBJECT / ACTION / SESSION
↓
INTENT
↓
APPLICATION
↓
EXECUTE
```

## What is stored

Local Shell-owned **reference metadata** only:

```ts
{
  id
  sessionId?
  objectiveType?
  currentAppId?
  objectReference?   // typed reference — never bytes
  actionReference?
  intentReference?
  returnPath?
  label?
  suggestedNextObjectives?  // suggestions only
  updatedAt
}
```

Never stored: file bytes, document contents, credentials, tokens, cookies, payment data, camera/audio streams, application database records.

## Continuation

`shell.objectives.continue()` revalidates before routing:

1. current operating context  
2. session state  
3. object reference  
4. originating application  
5. compatible handler  
6. availability  
7. permission requirements  

Honest outcomes include:

`AVAILABLE` · `NO_CURRENT_WORK` · `SESSION_ENDED` · `APPLICATION_UNAVAILABLE` · `OBJECT_NOT_FOUND` · `STALE` · `PERMISSION_REQUIRED` · `CONTINUATION_UNAVAILABLE`

A preferred-but-unavailable application is never silently replaced unless another route is independently compatible.

## Handoff

Handoffs carry references and routes only. Applications should acknowledge:

`handoff.accepted` / `handoff.rejected`

Navigation alone is not proof of successful handoff.

Return proposals use `context.propose`. The Shell decides what becomes current.

## Recent work

Dock → **Recent** and Home → **Continue Working** expose bounded local entries (current + up to 3 recent).

Clearing continuity returns routing to deterministic defaults without deleting application data.

## Preferences + continuity

1.8 preferences still rank routes. Explicit preference never overrides incompatibility or authorization. Continuity never grants capability.

## LifeOS vs mybrandOS

- **LifeOS** remains discovery-oriented for its own application state.
- **mybrandOS** remains the first-party creator executor.
- Shell continuity coordinates place; applications execute.

## Privacy

Continuity is local, minimal, bounded, transparent, and user-controllable. No cloud activity graph, analytics database, or cross-device behavioral profile.

## SDK

```ts
shell.context.current()
shell.context.clear()
shell.context.propose({ objectReference, suggestedNextObjectives? })
shell.objectives.continue()
shell.continuity.recent()
shell.continuity.open(reference)
shell.continuity.clear()
```

Applications cannot arbitrarily write Shell context. They may propose; the Shell decides.

## Permanent bans

No WorkflowEngine, TaskEngine, UniversalWorkflowDB, CloudContextBackend, CredentialHandoff, ShellMediaEngine, or new primitive.
