import { webLaunchPath } from "./launch.js";
import type {
  InstallCapability,
  InstallationPlatformAdapter,
  LaunchEntryRequest,
  LaunchEntryResult,
} from "./platform.js";

/**
 * OS Xperience Web installation. Every target gets its own web app manifest — distinct `id` and
 * `start_url` (`/?ox-launch=<type>:<id>`), trusted name and a locally drawn monogram icon — written
 * by this page into Cache Storage and served by the OS Xperience service worker under
 * `/ox-install/<type>/<id>/`. The browser then installs that manifest with whatever mechanism it
 * really has; nothing is claimed that the browser does not expose.
 */
export const INSTALL_ENTRY_CACHE = "ox-install-entries-v1";
export const INSTALL_ENTRY_PREFIX = "/ox-install/";
const BACKGROUND = "#05070f";

export interface DeferredInstallPrompt {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface WebEntryResource {
  path: string;
  contentType: string;
  body: string | Blob;
}

/** Everything the adapter touches in the browser, injectable for tests. */
export interface WebInstallEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  /** Running as an installed web app (display-mode standalone, or iOS Home Screen). */
  standalone(): boolean;
  /** Chromium's install prompt API exists in this browser. */
  hasInstallPromptApi: boolean;
  hasServiceWorker: boolean;
  /** Resolves true once the OS Xperience service worker controls this page (bounded wait). */
  serviceWorkerControlled(): Promise<boolean>;
  putEntryResources(resources: WebEntryResource[]): Promise<void>;
  renderPng(svg: string, size: number): Promise<Blob | null>;
  /** Points the page at a target's manifest; null restores OS Xperience's own. */
  setManifest(href: string | null): void;
  /** iOS/macOS Safari read title and touch icon from the page; null restores. */
  setAppleEntry(entry: { title: string; iconHref: string } | null): void;
  /** Safari may use the current URL as the entry's start; null restores. */
  setLaunchUrl(path: string | null): void;
  /** The next install prompt the browser offers for the current manifest, or null after the timeout. */
  nextInstallPrompt(timeoutMs: number): Promise<DeferredInstallPrompt | null>;
}

type WebBrowserKind = "IOS" | "MAC_SAFARI" | "CHROMIUM" | "OTHER";

export function detectWebBrowser(env: Pick<WebInstallEnvironment, "userAgent" | "maxTouchPoints" | "hasInstallPromptApi">): WebBrowserKind {
  const ua = env.userAgent;
  // iPadOS reports a Macintosh user agent; touch points tell it apart from a Mac.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)) return "IOS";
  if (env.hasInstallPromptApi) return "CHROMIUM";
  const safariVersion = /Version\/(\d+)[^ ]* .*Safari\//.exec(ua);
  if (/Macintosh/.test(ua) && safariVersion && !/Chrome|Chromium|Edg\/|OPR\/|Firefox/.test(ua) && Number(safariVersion[1]) >= 17) return "MAC_SAFARI";
  return "OTHER";
}

export function webInstallCapability(env: WebInstallEnvironment): InstallCapability {
  const unsupported = (reason: string): InstallCapability => ({ platform: "WEB", mechanism: "NONE", supported: false, requiresUserConfirmation: false, reason });
  const kind = detectWebBrowser(env);
  if (kind === "IOS") {
    // An iOS Home Screen web app has no Safari Share sheet; installing happens from Safari.
    if (env.standalone()) return unsupported("IOS_STANDALONE_HAS_NO_SHARE_SHEET");
    return { platform: "WEB", mechanism: "WEB_ADD_TO_HOME_SCREEN", supported: true, requiresUserConfirmation: true };
  }
  if (kind === "CHROMIUM") {
    if (!env.hasServiceWorker) return unsupported("NO_SERVICE_WORKER");
    return { platform: "WEB", mechanism: "WEB_INSTALL_PROMPT", supported: true, requiresUserConfirmation: true };
  }
  if (kind === "MAC_SAFARI") {
    if (env.standalone()) return unsupported("MAC_STANDALONE_HAS_NO_ADD_TO_DOCK");
    return { platform: "WEB", mechanism: "WEB_ADD_TO_DOCK", supported: true, requiresUserConfirmation: true };
  }
  return unsupported("BROWSER_HAS_NO_INSTALL_MECHANISM");
}

export function entryResourceBase(request: Pick<LaunchEntryRequest, "type" | "id">): string {
  return `${INSTALL_ENTRY_PREFIX}${request.type === "APP" ? "app" : "space"}/${request.id}/`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}

export function monogramSvg(request: Pick<LaunchEntryRequest, "monogram" | "color">): string {
  const size = request.monogram.length > 1 ? 120 : 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${escapeXml(request.color)}"/><text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${escapeXml(request.monogram)}</text></svg>`;
}

/**
 * The manifest carries identity and presentation only: id/start_url name the target, nothing
 * else rides along (no token, no session, no mode override, no remote URL).
 */
export function entryManifest(request: LaunchEntryRequest, icons: { png: boolean }): Record<string, unknown> {
  const base = entryResourceBase(request);
  const launch = webLaunchPath(request.type, request.id);
  return {
    id: launch,
    name: request.label,
    short_name: request.label,
    start_url: launch,
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    icons: [
      ...(icons.png
        ? [
            { src: `${base}icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: `${base}icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ]
        : []),
      { src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

export interface WebInstallationAdapter extends InstallationPlatformAdapter {
  /** Retries a browser prompt that needed a fresh tap. */
  confirmPending(): Promise<LaunchEntryResult>;
  /** Restores OS Xperience's own manifest, title and URL once the human is done. */
  reset(): void;
}

export function createWebInstallationAdapter(env: WebInstallEnvironment): WebInstallationAdapter {
  let pendingPrompt: DeferredInstallPrompt | null = null;

  const reset = () => {
    pendingPrompt = null;
    env.setManifest(null);
    env.setAppleEntry(null);
    env.setLaunchUrl(null);
  };

  const runPrompt = async (prompt: DeferredInstallPrompt): Promise<LaunchEntryResult> => {
    try {
      await prompt.prompt();
    } catch {
      // The browser needs a fresh user gesture: keep the prompt for a second tap.
      pendingPrompt = prompt;
      return { status: "PENDING_CONFIRMATION", guidance: "BROWSER_PROMPT" };
    }
    pendingPrompt = null;
    const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    reset();
    return choice.outcome === "accepted" ? { status: "CREATED" } : { status: "DISMISSED" };
  };

  const writeResources = async (request: LaunchEntryRequest): Promise<{ manifest: string; svgIcon: string; pngIcon: string | null }> => {
    const base = entryResourceBase(request);
    const svg = monogramSvg(request);
    const [png192, png512] = await Promise.all([env.renderPng(svg, 192), env.renderPng(svg, 512)]);
    const png = Boolean(png192 && png512);
    const resources: WebEntryResource[] = [
      { path: `${base}manifest.webmanifest`, contentType: "application/manifest+json", body: JSON.stringify(entryManifest(request, { png })) },
      { path: `${base}icon.svg`, contentType: "image/svg+xml", body: svg },
      ...(png ? [
        { path: `${base}icon-192.png`, contentType: "image/png", body: png192! },
        { path: `${base}icon-512.png`, contentType: "image/png", body: png512! },
      ] : []),
    ];
    await env.putEntryResources(resources);
    return { manifest: `${base}manifest.webmanifest`, svgIcon: `${base}icon.svg`, pngIcon: png ? `${base}icon-512.png` : null };
  };

  return {
    platform: "WEB",
    async capability() {
      return webInstallCapability(env);
    },
    async createEntry(request) {
      const capability = webInstallCapability(env);
      if (!capability.supported) return { status: "UNSUPPORTED", reason: capability.reason ?? "UNSUPPORTED" };
      reset();
      let paths: Awaited<ReturnType<typeof writeResources>>;
      try {
        paths = await writeResources(request);
      } catch {
        return { status: "FAILED", reason: "ENTRY_RESOURCES_UNAVAILABLE" };
      }
      // Without the service worker the manifest URL would resolve to the app shell, not the target.
      if (!(await env.serviceWorkerControlled())) return { status: "FAILED", reason: "SERVICE_WORKER_NOT_READY" };
      if (capability.mechanism === "WEB_INSTALL_PROMPT") {
        // Listen before the swap: the browser re-evaluates installability as soon as the manifest changes.
        const nextPrompt = env.nextInstallPrompt(4000);
        env.setManifest(paths.manifest);
        const prompt = await nextPrompt;
        // No prompt: the browser either already has this entry or offers install only from its menu.
        if (!prompt) return { status: "PENDING_CONFIRMATION", guidance: "BROWSER_MENU" };
        return runPrompt(prompt);
      }
      env.setManifest(paths.manifest);
      env.setAppleEntry({ title: request.label, iconHref: paths.pngIcon ?? paths.svgIcon });
      env.setLaunchUrl(webLaunchPath(request.type, request.id));
      return { status: "PENDING_CONFIRMATION", guidance: capability.mechanism === "WEB_ADD_TO_DOCK" ? "ADD_TO_DOCK" : "SHARE_ADD_TO_HOME_SCREEN" };
    },
    async confirmPending() {
      if (!pendingPrompt) return { status: "FAILED", reason: "NO_PENDING_PROMPT" };
      return runPrompt(pendingPrompt);
    },
    // Browsers do not let a page enumerate installed web apps.
    async presentEntries() {
      return null;
    },
    reset,
  };
}

/* ------------------------------------------------------------------ browser environment */

const MANIFEST_LINK_ID = "ox-manifest";

export function browserWebInstallEnvironment(win: Window & typeof globalThis): WebInstallEnvironment {
  const doc = win.document;
  const waiters = new Set<(prompt: DeferredInstallPrompt) => void>();
  // Only a target install in progress takes the prompt; otherwise the browser's own UI is left alone.
  win.addEventListener("beforeinstallprompt", (event) => {
    if (waiters.size === 0) return;
    event.preventDefault();
    for (const waiter of waiters) waiter(event as unknown as DeferredInstallPrompt);
    waiters.clear();
  });
  const defaultManifest = (doc.querySelector(`link[rel="manifest"]`) as HTMLLinkElement | null)?.getAttribute("href") ?? "/manifest.webmanifest";
  const defaultTitle = (doc.querySelector(`meta[name="apple-mobile-web-app-title"]`) as HTMLMetaElement | null)?.content ?? "OS Xperience";
  const defaultTouchIcon = (doc.querySelector(`link[rel="apple-touch-icon"]`) as HTMLLinkElement | null)?.getAttribute("href") ?? "/icons/icon.svg";
  const defaultDocTitle = doc.title;
  let launchUrlBefore: string | null = null;
  // Restore only what an install borrowed; never overwrite what the page set for itself.
  let manifestBorrowed = false;
  let appleBorrowed = false;

  const ensureLink = (rel: string): HTMLLinkElement => {
    let link = doc.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
    if (!link) {
      link = doc.createElement("link");
      link.rel = rel;
      doc.head.appendChild(link);
    }
    return link;
  };

  return {
    userAgent: win.navigator.userAgent,
    maxTouchPoints: win.navigator.maxTouchPoints ?? 0,
    standalone: () =>
      win.matchMedia?.("(display-mode: standalone)").matches === true ||
      win.matchMedia?.("(display-mode: minimal-ui)").matches === true ||
      (win.navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasInstallPromptApi: "onbeforeinstallprompt" in win,
    hasServiceWorker: "serviceWorker" in win.navigator && "caches" in win,
    async serviceWorkerControlled() {
      if (!("serviceWorker" in win.navigator)) return false;
      if (win.navigator.serviceWorker.controller) return true;
      return new Promise<boolean>((resolve) => {
        const timer = win.setTimeout(() => resolve(Boolean(win.navigator.serviceWorker.controller)), 4000);
        win.navigator.serviceWorker.addEventListener("controllerchange", () => {
          win.clearTimeout(timer);
          resolve(true);
        }, { once: true });
      });
    },
    async putEntryResources(resources) {
      const cache = await win.caches.open(INSTALL_ENTRY_CACHE);
      await Promise.all(resources.map((item) => cache.put(
        new URL(item.path, win.location.origin).toString(),
        new Response(item.body, { headers: { "content-type": item.contentType, "cache-control": "no-cache" } }),
      )));
    },
    async renderPng(svg, size) {
      try {
        const image = new Image(size, size);
        const loaded = new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("ICON_RENDER_FAILED"));
        });
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await loaded;
        const canvas = doc.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(image, 0, 0, size, size);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      } catch {
        return null;
      }
    },
    setManifest(href) {
      if (href == null && !manifestBorrowed) return;
      manifestBorrowed = href != null;
      const link = ensureLink("manifest");
      link.id = MANIFEST_LINK_ID;
      link.setAttribute("href", href ?? defaultManifest);
    },
    setAppleEntry(entry) {
      if (entry == null && !appleBorrowed) return;
      appleBorrowed = entry != null;
      let meta = doc.querySelector(`meta[name="apple-mobile-web-app-title"]`) as HTMLMetaElement | null;
      if (!meta) {
        meta = doc.createElement("meta");
        meta.name = "apple-mobile-web-app-title";
        doc.head.appendChild(meta);
      }
      meta.content = entry?.title ?? defaultTitle;
      ensureLink("apple-touch-icon").setAttribute("href", entry?.iconHref ?? defaultTouchIcon);
      doc.title = entry?.title ?? defaultDocTitle;
    },
    setLaunchUrl(path) {
      if (path) {
        launchUrlBefore ??= `${win.location.pathname}${win.location.search}${win.location.hash}`;
        win.history.replaceState(win.history.state, "", path);
      } else if (launchUrlBefore != null) {
        win.history.replaceState(win.history.state, "", launchUrlBefore);
        launchUrlBefore = null;
      }
    },
    nextInstallPrompt(timeoutMs) {
      return new Promise((resolve) => {
        const timer = win.setTimeout(() => {
          waiters.delete(done);
          resolve(null);
        }, timeoutMs);
        const done = (prompt: DeferredInstallPrompt) => {
          win.clearTimeout(timer);
          resolve(prompt);
        };
        waiters.add(done);
      });
    },
  };
}
