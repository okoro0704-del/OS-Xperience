# Objectives and Workflows (OS Shell 1.7)

OS Shell 1.7 introduces the **Universal Task & Workflow Launcher**.

Protocol remains `os-shell / 0.7`. Objectives contract: `1.7`.

## Core principle

```
The human expresses the objective.
The Shell discovers the route.
The application performs the work.
```

```
Objective ≠ Intent
Objective ≠ Capability
Objective ≠ Authorization
Discovery ≠ Execution
```

There is **no** Task Engine, Workflow Engine, AI planner, or workflow database.

## Objective vocabulary

```
create · open · view · edit · share · import · export · publish · preview · continue
```

Objectives are human-facing. Intents remain the execution-routing contract.

## Discovery

Applications declare objectives in the manifest:

```ts
objectives: {
  create: ["video", "music", "writing"],
  edit: ["asset", "text"],
  preview: ["video", "software"],
  publish: ["asset"],
  continue: ["*"]
}
```

Declaration ≠ availability. Dynamic hints (for example `runtime_unavailable`) keep availability honest.

## Routing pipeline

```
Human Objective
  → Objective Discovery
  → Candidate Routes
  → Availability / Context / Permission state
  → Application Selection
  → Existing Action / Intent
  → Existing Session
  → Application Execution
```

## SDK

```ts
shell.objectives.discover({ query: "Create video" })
shell.objectives.start({ query: "Create video", targetAppId?: "mybrandos" })
shell.objectives.current()
shell.objectives.cancel()
```

Outside Shell: `shell.isAvailable === false`. Applications must keep working standalone.

## CONTINUE

`continue` reuses operating sessions and resume points. The Shell remembers workflow location, not application private state. If reconstruction is unsafe: `resume_unavailable`.

## Third-party participation

Demo Notes declares and routes through the same public contract as LifeOS and mybrandOS. No privileged first-party objective API.

## Security

Objective routing never transfers credentials, tokens, balances, or private files. Capability permission remains a separate explicit step.
