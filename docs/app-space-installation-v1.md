# OS Xperience — App + Space Installation V1

**Status: IMPLEMENTED — manual device verification required.** Builds on
[Space Installation V1](space-installation-v1.md) and [Space Launch File V1](space-launch-file-v1.md)
(both frozen; their contracts are unchanged — see *Frozen files* below).

> FIND IT. INSTALL IT. LEAVE OS XPERIENCE. TAP ITS ICON. ENTER IT.

OS Xperience is the installer and may be the runtime. It is never the destination of an installed
target: **Tap App → App. Tap Space → Space.**

## One action, two things

| | APP | SPACE |
|---|---|---|
| What it is | an application experience | a continuity environment |
| First principle | network-first | continuity-first |
| INSTALL does | records *what* launches, asks the platform for an entry | Space Launch File V1 verify → register → Offline Kernel preparation → Space Installation V1 home-entry record → platform entry |
| Launch resolves through | `resolveInstalledApp` → `requireExecutionTarget(…, "APP")` | frozen `resolveInstalledSpace` → `requireExecutionTarget(…, "SPACE")` |
| Offline | only what the App itself declares; otherwise **needs a connection** | local Offline Kernel state; nothing remote is faked |

A Space is never installed by pretending it is an App, and neither ever substitutes for the other.

## Architecture

```
OS Xperience Web | Android | iOS
  └─ INSTALL → InstallableTarget (APP | SPACE) → installTarget()   packages/xperience-ui/src/installation
        validate → APP path | SPACE path (frozen V1 owners)
        → InstallationPlatformAdapter (detected by runtime, never by product logic)
            WebInstallationAdapter     per-target manifest + install prompt / Add to Home Screen
            AndroidInstallationAdapter pinned launcher shortcuts (same plugin as Space V1)
            IOSInstallationAdapter     Safari handoff (Apple-supported Add to Home Screen)
        → InstallResult
DEVICE ICON → launch request → resolveLaunchMode() BEFORE the first render
        XPERIENCE_NORMAL → OS Xperience Home
        DIRECT_APP       → App resolver   → App is the only visible root
        DIRECT_SPACE     → Space resolver → Offline Kernel → Space is the only visible root
        DIRECT_INVALID   → that target's recovery surface (never Home)
```

Native code is an adapter only; the installation domain (contract, validation, registry, results,
launch routing) lives in OS Xperience.

### Contract — `InstallableTarget`

A discriminated union. Shared: `type`, `id`, `name` (trusted presentation), `icon` (`monogram`,
`color` — drawn locally, never remote), `version?`, `source`. APP adds `launchTarget: {mode:"APP"}`,
`offlineCapability`, `authMode`. SPACE adds `launchTarget: {mode:"SPACE", broadcastChannelId}` and
`launchFile: {registered, bundledArtifact}`. `validateInstallableTarget` refuses unknown types, bad
identities, control characters, remote icons, mismatched launch modes and **any unknown field**
(`UNSAFE_METADATA`), so nothing can ride into an install.

Identity is `app:<id>` / `space:<id>` on every platform — `space:<id>` is exactly the Space V1
shortcut ID. One provider (e.g. `bootstrap.mybrandos.public`) can hold both entries without collision.

### Results

`INSTALLED`, `ALREADY_INSTALLED`, `INSTALLATION_PENDING_PLATFORM_CONFIRMATION` (+ guidance:
`LAUNCHER`, `BROWSER_PROMPT`, `BROWSER_MENU`, `SHARE_ADD_TO_HOME_SCREEN`, `ADD_TO_DOCK`, `SAFARI`),
`UNSUPPORTED_PLATFORM`, `INVALID_TARGET`, `INSTALLATION_FAILED` (`USER_DISMISSED`, …),
`SPACE_HYDRATION_FAILED` (`OFFLINE`, `NO_ROUTE`, `FAILED`), `LAUNCH_ENTRY_FAILED`. Internal reason
codes are kept; `installResultMessage` gives plain copy ("Confirm on your Home Screen to add …" only
when a confirmation will actually appear; "… is on your Home Screen." for `alreadyPinned`).

A failed or dismissed entry rolls back only what that attempt added (no false installed state). A
Space whose preparation fails keeps its verified registration but gets no entry.

### Installation registry — `ox.installed-targets.v1`

`{ type, id, key, label, version?, platform, launchEntryState: PENDING_CONFIRMATION|CONFIRMED,
installedAt, updatedAt }` — an index only. Space continuity stays in its owners
(`ox.space-registrations.v1`, `ox.space-home-entries.v1`, the Offline Kernel). Forged (key not
derived from type+id), malformed or extra-field rows are ignored.

`targetInstallationView` derives (never persists) `NOT_INSTALLED | INSTALLING | INSTALLED |
UPDATE_AVAILABLE | BROKEN | REMOVING`, keeping **launch entry** (`NONE | PENDING_CONFIRMATION |
PRESENT | UNKNOWN`) apart from **Space continuity** (`READY | NEEDS_PREPARATION |
MISSING_REGISTRATION`). An icon alone is not a Space: a pinned Space without its registration or
home-entry record is `BROKEN`. Browsers cannot enumerate installed web apps, so a web entry's
presence is reported as `UNKNOWN`, not asserted.

## Direct target launch

Resolved before the first render from the launch request alone (`resolveLaunchMode`). In a DIRECT
mode `ExperienceApp` mounts only the target root: no Home, Directory, top bar, navigation, banners,
switcher, Xperience controls, escape gestures or OS Xperience branding — and the update gate is
silent. Leaving goes to the operating system. A failure shows the **target's** recovery surface
("<Name> couldn't be opened." · Retry · Repair installation · Remove), never OS Xperience Home.
A direct launch never becomes what OS Xperience itself restores next time.

**Android.** Every entry (Space V1 shortcuts already on launchers included) targets the non-exported
`SpaceEntryActivity` trampoline, which now opens the launch in `TargetActivity` — its **own task**
(`documentLaunchMode="intoExisting"`, keyed `ox-target:<type>:<id>`), never the OS Xperience task.
Hence:

| | Before (OPPO) | Now |
|---|---|---|
| Cold tap | splash → OS Xperience shell → Space | unbranded dark window → target |
| Warm tap (OS Xperience showing Home or Space A) | OS Xperience task resumes on its last screen, then switches | target's own task; Space A / Home never shown |
| Back at target root | OS Xperience Home | minimises the target's task → launcher |
| Recents | one "OS Xperience" card | one card per target, named and coloured by the target (`presentTarget`) |
| OS Xperience icon | — | always its own task → Home |

Same process, same `https://localhost` origin and storage — one runtime powers every target. The
target task keeps its launch across WebView reloads; a target task whose launch cannot be read shows
`DIRECT_INVALID`, never Home.

**Web.** A web entry's `start_url` is `/?ox-launch=<type>:<id>`; the page reads it before rendering.
Only an installed web app window (`display-mode: standalone`) may *adopt* an entry that its own
storage does not know yet (iOS Home Screen web apps get separate storage): it re-verifies the Space
from the build's signed launch file / re-resolves the released App and records it. A link opened in
a tab never installs anything.

## Platforms

| Runtime | Mechanism | Human step |
|---|---|---|
| Android (native) | `ShortcutManagerCompat.requestPinShortcut` (APP + SPACE) | launcher confirmation; none when already pinned (`alreadyPinned`) |
| Android Chrome (web) | per-target manifest + `beforeinstallprompt` | browser install dialog (else browser menu → Install app) |
| Desktop Chrome / Edge (web) | same; installs an app window per target | browser install dialog |
| iPhone / iPad Safari (web) | per-target manifest, title, touch icon, launch URL | Share → Add to Home Screen |
| macOS Safari 17+ (web) | same | File → Add to Dock |
| Firefox / others (web) | none | `UNSUPPORTED_PLATFORM` — no button that cannot work |
| iOS (native) | Safari handoff: opens `https://xperience.getlifeos.app/?ox-install=<type>:<id>` in Safari | Add to Home Screen in Safari |
| Windows (native) | not built in V1 | `UNSUPPORTED_PLATFORM` via `createUnsupportedInstallationAdapter` |

Web manifests and icons are generated by the page (trusted name, monogram) into Cache Storage
`ox-install-entries-v1` and served by `sw.js` under `/ox-install/<type>/<id>/`; an unknown path is
a 404, so a crafted URL never becomes an installable entry. INSTALL is offered only once the service
worker controls the page. The OS Xperience manifest/title are restored when the person leaves.

### iOS (intended, not faked)

INSTALL → Apple-supported Home Screen entry → tap → exact App/Space. Native iOS has no API for an app
to add its own Home Screen icons, so V1 hands off to Safari. Consequences stated honestly: the icon
opens the **web runtime**, not the native iOS app, and it starts with storage of its own — the Space
re-verifies from its signed launch file and needs one online preparation before it runs offline. No
private API, no platform-security bypass. A later native adapter (App Intents / widgets) may differ
internally; the product action stays INSTALL.

### Windows (intended)

INSTALL → desktop/Start entry → double-click → OS Xperience runtime → exact App/Space, with one
runtime and individually addressable targets — no EXE per App or Space. Today the web adapter already
gives this on desktop Chrome/Edge (one app window per target, `start_url` = the target).

### Master Distributor boundary

Distribution decides what is available (signed catalog / Directory → `installableTargetsFor`);
OS Xperience installs and launches it (`installTarget`, adapters, `resolveLaunchMode`). Nothing in
the installation domain chooses what is offered.

## Security

- A launch entry and an installed record identify **what** launches: target type, identity,
  version, trusted presentation. Never TrustID credentials, biometric templates or embeddings,
  session cookies or secrets, authority tokens, Digi Authority grants, financial authorization or
  API secrets. Tests assert the exact field sets.
- Installation is not authentication. Origin is not authority. A launch entry is not authority.
  A protected capability inside an App still summons TrustID.
- Launch requests are untrusted: Android APP intents follow the same strict grammar as Space intents
  (action, no data, exactly one identity extra, no other `ox.*` extra); SPACE intents still pass the
  frozen `parseSpaceLaunch`. Web launches read only the target key.

## Space content — a Space runs without internet, broadcast or not

A Space is its provider's software running without internet. TV and Radio are experiences of a
Space, never preconditions for it. (Found on the OPPO: MrFundzMan declares channel `mrfundzman.tv`,
which has no published schedule, so V1 readiness — "the channel plays locally" — blocked a Space
whose publisher has published media.)

- **Nobody prepares a Space by hand.** The creator's post is its preparation. There is no Prepare
  button anywhere; the UI only says a Space "syncs automatically".
- **Automatic sync** (`prepareSpaceContent`, automatic mode): while the device has any connection,
  every registered Space syncs its publisher's published content into the Offline Kernel
  (`syncSpaceLibrary`, `library:<spaceId>` / `library-bytes:<itemId>`), and its broadcast when it has
  one — on start, on reconnect (failed attempts retry at once), and every 30 minutes. An offline
  device never sends a sync request (connectivity is re-read at run time). Install also syncs.
- **Background delivery while closed** (Android): OS Xperience hands `SpaceContentSyncPlugin` the
  registered Spaces' brand routes (re-validated natively, `SpaceContentRules`); WorkManager
  (`SpaceContentSyncWorker`, CONNECTED + storage-not-low, now and hourly) downloads new or changed
  posts into private storage (`filesDir/space-content/<spaceId>/`), streaming to `.part` and renaming.
  On the next start or resume OS Xperience adopts them into the kernel one at a time
  (`adoptSpaceLibraryItems`) and releases the files; the index remembers delivered versions so they
  are not fetched again. Unpublished posts leave the device.
- **Readiness** (`spaceLocallyReady`): held content **or** a locally playable channel. Read from the
  kernel only; no request.
- **Route**: the provider's own brand origin (`https://<slug>.getlifeos.app`, `spaceLibraryRoute`),
  read through its public, uncredentialed API (`/api/public/<slug>/assets`, `/media`, `/cover`).
  Never a guessed host; redirects are not followed. Android reads it over native HTTP
  (`spaceContentFetch`): the WebView origin `https://localhost` is, correctly, not in the provider's
  credentialed CORS allowlist.
- **Opening**: online, an unprepared Space opens (its live software) and syncs in the background.
  Offline, a Space with held content opens and shows it (`space-library`); with nothing held it
  says honestly that it needs a connection.
- **Integrity**: bytes are stored only as received; a publisher checksum, when present, must match.
  The mybrandOS public catalog supplies none today, so items are never claimed as verified.
- **Bounds**: at most `SPACE_LIBRARY_MAX_ITEMS` (24) items; unchanged items are not re-downloaded;
  a failed catalog read keeps the last held library; Delete offline data removes the library too
  (it syncs again the next time the device is connected). Background items over 256 MB are skipped.

## Frozen files touched — why, what, compatibility

| File | Why | What | Compatibility |
|---|---|---|---|
| `SpaceHomeEntryPlugin.java` | APP entries; direct launch | `app:` shortcuts (`OPEN_APP` + `ox.app.id`) via the same trampoline; `pinned()` lists `space:` and `app:`; static inbox replaced by the target task's launch; `presentTarget`; `takeLaunch` reports `targetTask` | Space branch unchanged: same prefix, validation, intent, icon, `alreadyPinned` logic and re-enable of disabled entries |
| `SpaceEntryActivity.java` | direct launch | forwards to `TargetActivity` instead of bringing `MainActivity` forward | same component, so icons already pinned keep working |
| `AndroidManifest.xml`, `styles.xml` | direct launch | adds non-exported `TargetActivity` and an unbranded launch theme | additive |
| `apps/os-experience/src/space-home-entry.ts`, `main.tsx` | one plugin proxy; launch before render | adds APP host, `presentDirectTarget`, `readInitialTargetLaunch` | Space host unchanged |
| `ExperienceApp.tsx` | INSTALL panel, direct mode, router | Space V1 card, Manage, Remove and `alreadyPinned` notice unchanged | V1 tests unchanged and passing |

Space Launch File V1 (`space-launch.ts`, verifier, registry) and the Space V1 domain module
(`local/space-home-entry.ts`) are **not modified**.

## Manual Android proof

Use the real App **mybrandOS** (`app:bootstrap.mybrandos.public`, the only APP the production signed
catalog releases today) and the real production Space **MrFundzMan**
(`space:bootstrap.mybrandos.public`). Not Second Space (TEST).

APP: OS Xperience → Directory → mybrandOS → **Install** (App row) → confirm on the launcher → leave
OS Xperience → icon "mybrandOS" present → tap → the mybrandOS App, with no OS Xperience frame first.
Force-stop OS Xperience → tap → App. Reboot → tap → App. Back → launcher (not OS Xperience). Recents
shows a "mybrandOS" card. Tap the OS Xperience icon → OS Xperience Home.

SPACE: OS Xperience → Directory → mybrandOS → **Install** (Space row) → (verify, prepare) → confirm
→ leave → icon "MrFundzMan" → tap → MrFundzMan Space, local TV on air, no OS Xperience frame. Open
OS Xperience, enter another Space, go Home, tap MrFundzMan → MrFundzMan (no Space A flash). Force-stop
→ tap → Space. Internet off → tap → local continuity (READY OFFLINE playback). Install again →
"MrFundzMan is on your Home Screen." (alreadyPinned). Back → launcher.

## Known limitations

- Web presence of an installed entry cannot be read back (`UNKNOWN`); "Add again" is offered.
- Headless/unsupported browsers that never offer an install prompt get "browser menu" guidance.
- iOS: Safari handoff only; separate storage per Home Screen web app.
- Android 12+ may still draw a system starting window before the first frame; it is unbranded.
- The catastrophic error boundary / boot watchdog still say "OS Xperience" (crash path only).
- The Space V1 step card (Install Space · Prepare · Add to Home Screen) is kept beside the unified
  INSTALL panel for compatibility; folding it into Manage is a follow-up.
- A post reaches a device only through a connection that device has had (install, any later
  connection, or background delivery). Device-to-device delivery, and content shipped inside the
  app, are designed next; they need a signed content manifest so copies can be trusted.
- Offline, a Space shows its synced content in OS Xperience's Space library — not the provider's own
  UI. Running the provider's full interface offline needs the provider to ship an offline app shell.
- mybrandOS public broadcast media paths omit `/api` (`/public/...`), which the deployed site serves
  as HTML; TV preparation from production needs that fixed in mybrandOS.
