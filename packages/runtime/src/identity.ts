import {
  WELL_KNOWN_MANIFEST_PATH,
  originOf,
  parseHttpUrl,
  parseManifest,
  resolveAppIdentity,
  sanitizeLaunchUrl,
  type AppIdentity,
  type AppManifest,
  type OriginPolicy,
} from "@osshell/contract";

export interface ResolvedNavigation {
  href: string;
  origin: string;
  identity: AppIdentity;
  manifest: AppManifest | null;
  manifestError: string | null;
}

export async function resolveNavigation(
  input: string,
  policy: OriginPolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedNavigation | { error: string }> {
  const raw = parseHttpUrl(input);
  if (!raw) return { error: "Enter an http(s) URL." };
  const href = sanitizeLaunchUrl(raw.toString());
  const url = new URL(href);
  const origin = originOf(url);
  if (!origin) return { error: "URL origin is invalid." };

  let manifest: AppManifest | null = null;
  let manifestError: string | null = null;
  try {
    const response = await fetchImpl(`${origin}${WELL_KNOWN_MANIFEST_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const parsed = parseManifest(await response.json(), origin);
      if (parsed.ok) manifest = parsed.manifest;
      else manifestError = parsed.detail;
    }
  } catch {
    manifestError = null;
  }

  const launchHref = manifest ? resolveLaunchHref(origin, manifest.launch, href) : href;
  const identity = resolveAppIdentity({ href: launchHref, origin, manifest, policy });
  return { href: sanitizeLaunchUrl(launchHref), origin, identity, manifest, manifestError };
}

function resolveLaunchHref(origin: string, launch: string, fallback: string): string {
  try {
    const resolved = new URL(launch, `${origin}/`);
    if (resolved.origin !== origin) return fallback;
    return sanitizeLaunchUrl(resolved.toString());
  } catch {
    return fallback;
  }
}
