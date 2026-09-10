# Preferences and Routing (OS Shell 1.8)

OS Shell 1.8 introduces the **Personal Routing & Preference Plane**.

Protocol remains `os-shell / 0.7`. Preferences contract: `1.8`.

## Core principle

```
The Shell remembers how the person prefers to work
without becoming the place where the work happens.
```

```
Preference ≠ Authorization
Preference ≠ Credential
Preference ≠ Capability
Preference ≠ Ownership
```

## What is stored

Local Shell-owned routing preferences only:

```ts
{
  appId
  objectiveType
  intentType?
  objectType?
  destination?
  source: EXPLICIT | RECENT_SUCCESS | DEFAULT
  updatedAt
}
```

Never stored: passwords, tokens, cookies, payment credentials, private application data, file bytes.

## Ranking order

1. exact explicit preference  
2. compatible explicit preference  
3. exact object/type compatibility  
4. current application  
5. active session  
6. first-party/default handler  
7. recent successful choice  
8. availability  
9. stable app ID  

Unavailable preferred apps are shown honestly and do not silently win.

## SDK

```ts
shell.preferences.list()
shell.preferences.get({ objectiveType, objectType? })
shell.preferences.set({ objectiveType, objectType?, appId? })
shell.preferences.clear({ objectiveType?, objectType? })
```

Applications may only set preferences for themselves. They cannot elevate routing priority for other apps.

## UI

- Launcher: **Recommended** / **Other options** / **Always use this app**
- User → Application preferences: change / clear

## LifeOS vs Shell

- **LifeOS**: help find options  
- **OS Shell**: use the person's preferred route  

Do not merge these roles.
