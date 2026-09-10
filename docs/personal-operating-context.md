# Personal Operating Context (OS Shell 2.0)

OS Shell 2.0 introduces the **Personal Operating Context Plane**.

Protocol remains `os-shell / 0.7`. Operating-context contract: `2.0`.

Cross-application continuity (1.9) remains the place-memory substrate. Preferences (1.8), objectives (1.7), actions (1.5), and sessions (1.4) are reused — not replaced.

## Core principle

```
The Shell should know enough to orient the human,
but never enough to replace the applications that own the work.
```

```
Context ≠ Permission
Context ≠ Authorization
Context ≠ Credential
Context ≠ Application State
Context ≠ Ownership
Context ≠ Capability
Context ≠ Workflow
Context ≠ Universal User Profile
```

## Context planes

| Plane | Answers |
| --- | --- |
| Current | What is the person doing now? |
| Recent | What were they recently working on? (bounded) |
| Preference | How do they prefer to work? (1.8) |
| Availability | What apps/capabilities are live? |
| Relationship | Safe links between object ↔ app ↔ session |

Not built: UniversalUserProfile, DigitalTwin, BehaviorGraph, PersonalDataLake.

## Sources

Every entry declares a source:

`CURRENT_SESSION` · `APPLICATION` · `OBJECT_REFERENCE` · `USER_PREFERENCE` · `RECENT_WORK` · `CAPABILITY` · `APPLICATION_MANIFEST`

Facts and suggestions are labeled separately. Suggestions never auto-execute.

## Resolution

`resolveOperatingContext()` is deterministic, bounded, local, and revalidating.

Priority:

1. active application/session  
2. current object reference  
3. current objective  
4. explicit preference  
5. compatible actions  
6. recent work  
7. defaults / availability  

## Scopes

Applications may request:

`CURRENT` · `OBJECT` · `SESSION` · `APPLICATION` · `OBJECTIVE`

Default is the smallest useful scope. Third parties do not receive global recent history.

## SDK

```ts
shell.context.current()
shell.context.snapshot({ scope?: "CURRENT" })
shell.context.clear()
shell.context.clearCurrent()
shell.context.clearRecent()
shell.context.propose({ objectReference, suggestedNextObjectives? })
```

Applications propose. The Shell validates and decides.

## Contextual language

Deterministic only (no AI):

```
continue · resume · preview it · edit this · share it
what am I working on? · what can I do with this?
```

Ambiguous matches ask the human to choose.

## Privacy

User → Privacy → Operating Context shows what the Shell remembers and lets the user clear current / recent / all.

## Progressive architecture

```
1.6 Discover → 1.7 Objective → 1.8 Preference → 1.9 Continuity → 2.0 Operating Context
```
