import type { Plugin } from "vite";

/**
 * Candidate Content-Security-Policy for OS Xperience (SP3 hardening). Not enforced by default: a build
 * enables it with OX_CSP=enforce, which injects it as a <meta> tag so it covers both the web build and
 * the Capacitor-bundled WebView (which never sees Netlify headers).
 *
 * What it protects: script execution is limited to the shell's own bundle and the pinned MediaPipe
 * loader, with no inline script and no eval, so markup that reaches the DOM (for example a package text
 * item) can never run. Package media is served from blob: URLs, which may be shown as images, audio or
 * video but never framed, loaded as script or used as a worker. Plugins (<object>/<embed>) are off.
 *
 * What stays broad, and why: registered providers are discovered at run time, so their apps (frames),
 * content APIs (connect) and artwork/media (img/media) are allowed for any https: origin. The MediaPipe
 * hand model is fetched (connect-src) from storage.googleapis.com.
 */
const MEDIAPIPE_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm/";

/** extraOrigins: local test/dev origins only, never production. */
export function contentSecurityPolicy(options: { extraOrigins?: string[] } = {}): string {
  const extra = options.extraOrigins ?? [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'wasm-unsafe-eval'", MEDIAPIPE_WASM],
    "style-src": ["'self'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:", "https:", ...extra],
    "media-src": ["'self'", "blob:", "https:", ...extra],
    "connect-src": ["'self'", "https:", ...extra],
    "frame-src": ["https:", ...extra],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** Vite plugin: injects the policy into index.html for builds that opt in. */
export function cspPlugin(): Plugin {
  const mode = process.env.OX_CSP;
  return {
    name: "ox-csp",
    apply: "build" as const,
    transformIndexHtml(html: string) {
      if (mode !== "enforce") return html;
      const extraOrigins = (process.env.OX_CSP_EXTRA_ORIGINS ?? "").split(/\s+/).filter(Boolean);
      const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy({ extraOrigins })}" />`;
      return html.replace("<meta charset=\"UTF-8\" />", `<meta charset="UTF-8" />\n    ${meta}`);
    },
  };
}
