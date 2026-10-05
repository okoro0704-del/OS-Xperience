# Space Installation V1

**Status: IMPLEMENTED — physical-device verification recorded in the mission report.** Builds on
[Space Launch File V1](space-launch-file-v1.md), which is frozen and is not modified here.

**A Space home-screen entry is not an application.** It is an Android launcher icon that carries one
thing — the Space's stable identity — into the single OS Xperience APK. OS Xperience decides on every
launch what that identity resolves to.

```
DIRECTORY → MRFUNDZMAN → INSTALL SPACE → VERIFY (V1) → REGISTER → PREPARE (OFFLINE KERNEL)
  → READY OFFLINE → ADD TO HOME SCREEN → LAUNCHER CONFIRMS → ICON
ICON → OS XPERIENCE → VALIDATE → RESOLVE SPACE IDENTITY → requireExecutionTarget(SPACE) → RUNNING SPACE
```

APP is network-first; SPACE is continuity-first. A shortcut never turns a SPACE into an APP and never
falls back to one.

## Non-goals

No per-Space APK, no silent installation, no `INSTALL_PACKAGES`, no remote icons, no store, no new
storage, no change to the WebView origin (`https://localhost`), no trust decisions in native code.

## States

Each owner keeps its own state; the installation layer only derives a display stage.

| Owner | State | Source of truth |
|---|---|---|
| Space Launch File V1 | registered / not registered | `ox.space-registrations.v1` |
| Offline Kernel | `NOT_PREPARED`, `ONLINE_PREPARATION_REQUIRED`, `READY_OFFLINE`, … | IndexedDB `digiconomy-offline-kernel` |
| Android launcher | pinned / not pinned | `ShortcutManager.getPinnedShortcuts()` |
| Space Installation | home-entry record | `ox.space-home-entries.v1` |

`spaceInstallationStage()` derives `NOT_INSTALLED → REGISTERED → PREPARING → READY_OFFLINE →
HOME_ENTRY_AVAILABLE → HOME_ENTRY_INSTALLED`. It is never persisted. `HOME_ENTRY_INSTALLED` does not
imply `READY OFFLINE`: readiness is re-evaluated against the schedule window on every launch, so stored
media whose schedule has expired is not playable.

`spaceHomeEntryState()` is `UNSUPPORTED` (no host — browsers, PWAs), `NOT_ELIGIBLE`, `AVAILABLE`,
`REQUESTED` (record written, launcher has not confirmed) or `INSTALLED` (record **and** Android reports
the shortcut pinned).

## Home-entry record

```json
{ "schemaVersion": 1, "entries": [
  { "spaceId": "bootstrap.mybrandos.public", "shortcutId": "space:bootstrap.mybrandos.public",
    "label": "MrFundzMan", "presentationSource": "LAUNCH_FILE",
    "createdAt": "…", "updatedAt": "…" } ] }
```

It duplicates nothing: no signature, launch file, media, schedule, blobs, TrustID, PDI or App record.
Malformed, duplicated or forged rows (shortcut ID not derived from the Space ID, control characters,
oversize labels, unknown presentation source) are ignored.

## Identity

The Space identity is the provider ID (same grammar as a launch file's `providerId`; no path, URL or
script can be expressed). The Android shortcut ID is `space:<providerId>`. It never depends on the
display name, icon, version, channel or file name, so:

- a version update refreshes the label of the same shortcut (`ShortcutManagerCompat.updateShortcuts`);
- two Spaces with the same name have different shortcuts and route independently;
- there is no shared "last Space" state.

The shortcut carries no secret, authority token or TrustID credential.

## Presentation

| Field | Source |
|---|---|
| Label | `presentation.name` of the verified, registered V1 launch file; otherwise the `name` of the signed catalog entry that releases the SPACE |
| Icon | a monogram drawn locally on the device from that label, on a colour derived from the Space identity |

Bundled or declared provider data alone is never enough to create an entry (`NOT_VERIFIED`).

**Decision:** V1's optional `presentation.icon` is not used. Fetching a remote icon would add an
unsigned network dependency to installation and to the launcher. V1 was not modified to add a signed
icon; signed icon acquisition is a V2 item.

## Launch contract

The shortcut intent targets the non-exported `SpaceEntryActivity` with action
`com.digiconomy.osexperience.action.OPEN_SPACE`, no data URI and exactly one extra, `ox.space.id`.

`SpaceEntryActivity` (own task affinity, `noHistory`, `excludeFromRecents`, `Theme.NoDisplay`) hands
the intent to an in-process inbox and brings `MainActivity` (singleTask) forward without
`CLEAR_TASK`, so a running WebView is never restarted.

The native layer only normalizes the intent into `{ action, hasData, extraKeys, spaceId }`. The web
layer (`parseSpaceLaunch`) accepts it only if: action matches, `hasData === false`, at most 32 extra
keys, exactly one `ox.space.id`, no other `ox.*` key (mode, url, …), and a valid Space ID. Anything
else is `INVALID TARGET`.

`resolveSpaceLaunch` then requires a home-entry record (`NOT_INSTALLED` otherwise), refuses a host
locked to another mode (`UNAVAILABLE`), and resolves through
`requireExecutionTarget(providerTargets(...), "SPACE")` — never with a fixed APP mode. No released
SPACE target → `UNAVAILABLE`. There is no URL, iframe, JavaScript or APP fallback.

| Outcome | Screen |
|---|---|
| READY OFFLINE | the running Space, local TV on air |
| registered, not prepared | "needs preparation" with **Prepare** (route available); offline: "Connect when available to prepare this Space."; online without a route: "This device has no preparation route for this Space yet." |
| no record | "This Space isn't installed on this device." |
| no SPACE target | "This Space isn't available on this installation." |
| malformed intent | "This shortcut can't be opened." |

## Cold and warm start

**Cold:** `main.tsx` awaits `takeLaunch()` (bounded to 1.5 s) before the first render. With a pending
launch the first screen is the Space launch screen, not Home; the boot-time "restore last Experience"
step is skipped so no other Space can appear first.

**Warm:** the plugin emits `spaceLaunch` (retained until consumed); OS Xperience takes the request and
switches in the same process and JavaScript context. One runtime, no reload.

Resolution reads each prepared media record at most once (`hydrateAndPrepareSpaceTv` wraps its store
in `readOnce`): a record carries its bytes, and a schedule repeating one media item would otherwise
structured-clone it once per program. Measured on the OPPO A5 with 105 MB media and 12 programs:
cold tap → local TV ≈ 6.3 s, warm ≈ 3.1 s (before: ≈ 30 s warm).

## Removal

Three independent actions, each changing only its own state:

| Action | Removes | Keeps |
|---|---|---|
| Remove from Home Screen | home-entry record; disables the pinned shortcut | registration, offline data |
| Remove registration | V1 registration | home-entry record, offline data |
| Delete offline data | the channel's schedule and the media only it references | registration, home-entry record |

Android does not let an app unpin a launcher icon. A removed entry is **disabled** ("Removed in OS
Xperience"); the user can drag it away. Pinned entries OS Xperience no longer records (for example
after app data was cleared) are disabled on the next start. Delete offline data is explained in a
confirmation dialog first.

Adding a removed Space again while its disabled icon is still on a launcher page re-enables that icon:
Android shows no confirmation for a shortcut that is still pinned, so the plugin enables it and
reports `alreadyPinned`, and OS Xperience says "<name> is on your Home Screen." For a new icon the
notice asks the user to confirm on the Home Screen and changes once Android reports the pin. The
launcher's confirmation is another app's window, so the plugin also emits `homeEntriesChanged` on
resume and OS Xperience re-reads the pinned set.

## Security

- Installation needs no TrustID and grants no authority; it writes only `ox.space-registrations.v1`
  (V1) and `ox.space-home-entries.v1`.
- Install from Directory reads the build's own signed `spaces/<id>.space` and runs the V1 verifier;
  tampered or unknown-publisher files are rejected and never get a shortcut.
- Only OS Xperience creates its shortcuts; `SpaceEntryActivity` is not exported, and the exported
  `MainActivity` ignores `OPEN_SPACE` extras.
- Trust verification stays in the web layer; native code checks formats only.

## Platform capability

`canInstallSpaceHomeEntry(host)`: Android native shell with a launcher that accepts pin requests →
SUPPORTED. Browsers and PWAs have no host → UNSUPPORTED; no Add to Home Screen button is shown and
nothing is faked.

## Uninstall, update and storage

- Uninstalling OS Xperience removes its shortcuts with it (Android behaviour) and erases
  registrations, home-entry records and offline data.
- An APK update (same signer) keeps all of them; the origin stays `https://localhost`, so storage is
  preserved.
- Storage is unchanged. `navigator.storage.persisted()` is `false` on the Android WebView: offline
  data is best effort and the system may clear it under storage pressure. The Manage panel says so.

## V2

Signed icon acquisition, durable storage, byte-level preparation progress.
