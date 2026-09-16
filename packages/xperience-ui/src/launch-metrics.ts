/**
 * Launch timing instrumentation for XperienceMode.
 * Logs interaction metrics only — never app content or credentials.
 */

export type LaunchPhase =
  | "tap"
  | "identity"
  | "destination"
  | "mode_entered"
  | "container"
  | "request"
  | "response"
  | "first_pixel"
  | "interactive";

export type LaunchTrace = {
  applicationId: string;
  name: string;
  t0: number;
  marks: Partial<Record<LaunchPhase, number>>;
};

const KEY = "__oxLaunchTrace";

export function beginLaunchTrace(app: { id: string; name: string }): LaunchTrace {
  const trace: LaunchTrace = {
    applicationId: app.id,
    name: app.name,
    t0: performance.now(),
    marks: { tap: 0 },
  };
  try {
    (window as Window & { [KEY]?: LaunchTrace })[KEY] = trace;
  } catch {
    /* ignore */
  }
  return trace;
}

export function markLaunch(trace: LaunchTrace | null | undefined, phase: LaunchPhase): void {
  if (!trace) return;
  trace.marks[phase] = performance.now() - trace.t0;
}

export function summarizeLaunch(trace: LaunchTrace | null | undefined): string {
  if (!trace) return "";
  const m = trace.marks;
  const line = [
    `app=${trace.name}`,
    m.mode_entered != null ? `mode=${Math.round(m.mode_entered)}ms` : null,
    m.response != null ? `response=${Math.round(m.response)}ms` : null,
    m.first_pixel != null ? `pixel=${Math.round(m.first_pixel)}ms` : null,
    m.interactive != null ? `interactive=${Math.round(m.interactive)}ms` : null,
  ]
    .filter(Boolean)
    .join(" ");
  try {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
    if (meta.env?.DEV || document.documentElement.dataset.oxDebug === "1") {
      console.info("[ox-launch]", line);
    }
  } catch {
    /* ignore */
  }
  return line;
}

/** Lightweight DNS/TLS warm for likely launch origins (no app execution). */
export function preconnectOrigins(urls: string[]): void {
  if (typeof document === "undefined") return;
  const seen = new Set<string>();
  for (const raw of urls) {
    try {
      const origin = new URL(raw).origin;
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      if (document.querySelector(`link[data-ox-preconnect="${origin}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "anonymous";
      link.dataset.oxPreconnect = origin;
      document.head.appendChild(link);
      const dns = document.createElement("link");
      dns.rel = "dns-prefetch";
      dns.href = origin;
      dns.dataset.oxPreconnect = `${origin}-dns`;
      document.head.appendChild(dns);
    } catch {
      /* ignore bad URLs */
    }
  }
}
