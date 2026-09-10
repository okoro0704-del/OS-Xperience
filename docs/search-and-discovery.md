# Search and Discovery (OS Shell 1.6)

OS Shell 1.6 introduces the **Universal Search & Discovery** coordination layer.

Protocol remains `os-shell / 0.7`. Search contract: `1.6`.

## Core boundaries

```
Search Result ≠ Object Ownership
Search Index ≠ Object Database
Search Result ≠ Authorization
Discovery ≠ Execution
```

The Shell coordinates discovery. Applications remain authoritative over their own searchable data.

## Architecture

```
Shell Query
  → Registered Search Providers
  → Provider Results
  → Shell Normalization
  → Unified Result List
  → Existing object / action / intent / session contracts
```

There is **no** Shell search backend, Elasticsearch, vector database, crawler, or Digital Life index.

## Query contract

```ts
shell.search.query({
  query: string
  types?: ("application" | "object" | "action")[]
  appIds?: string[]
  limit?: number
  scope?: "all" | "applications" | "objects" | "actions" | "current_app" | "current_session"
})
```

Keep queries small. No SQL-like filters. No exposure of application databases.

## Result contract

```ts
{
  type: "application" | "object" | "action"
  title: string
  subtitle?: string
  appId?: string
  context?: OSShellContextReference  // existing reference model
  action?: string                    // existing intent vocabulary
}
```

Object results must use the existing reference model. References remain non-authorizing.

## Manifest declaration

```ts
{
  search?: {
    supportedTypes: string[]  // e.g. ["object", "text"] or ["object", "asset", "project"]
  }
}
```

Applications that omit `search` remain valid. Declaration ≠ permission to search all user data.

## Provider registration

Applications participate by declaring search in the manifest and responding to:

```
search.provider.query  →  search.provider.result
```

SDK helper:

```ts
getOSShellContext({
  onSearchProviderQuery: ({ query, limit }) => ([/* safe results */])
})
```

Providers must:

- return only data they are allowed to expose
- stay within result count / title / subtitle limits
- never include credentials, tokens, KMS keys, raw bytes, or private storage URLs
- answer within the provider timeout (default 800ms)

## Shell-owned search

The Shell may search Shell-owned records only:

- applications / installed apps / favorites
- sessions / safe resume points
- selected object + action metadata

This is not a global application-data index.

## Availability

```
SEARCH_AVAILABLE
SEARCH_UNAVAILABLE
SEARCH_NOT_SUPPORTED
SEARCH_INCOMPATIBLE
```

Never show an application as searchable unless it declared a provider. Partial results are required: one slow or unavailable provider must not fail the whole query.

## Ranking

Deterministic only:

1. Exact application name
2. Exact title
3. Prefix match
4. Type / session / current-app relevance

No ML ranking, advertising, popularity, or behavioral profiling.

## Privacy

- Recent search history is Shell-owned and clearable.
- Applications cannot read global search history.
- Applications cannot read other providers’ results.
- Audit events omit sensitive query contents and private payloads.

## SDK

```ts
shell.search.query(...)
shell.search.clearHistory()
```

Outside Shell: `shell.isAvailable === false`. Application-local search must continue to work without Shell.

## Routing

Selecting a result uses existing contracts:

| Result | Flow |
| --- | --- |
| Application | launch / navigation |
| Object | select context → action discovery |
| Action | intent / action request → handler → session |

Search never executes capabilities directly and never grants permissions.
