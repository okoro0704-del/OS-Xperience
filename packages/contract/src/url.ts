const FORBIDDEN_QUERY_KEYS = [
  "trustid",
  "token",
  "access_token",
  "id_token",
  "session",
  "session_token",
  "devicetoken",
  "x-production-device",
  "refresh_token",
  "password",
  "secret",
  "api_key",
  "apikey",
  "private_key",
  "privatekey",
  "otp",
  "pin",
  "cookie",
  "authorization",
] as const;

export function parseHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function originOf(value: string | URL): string | null {
  const url = typeof value === "string" ? parseHttpUrl(value) : value;
  return url ? url.origin : null;
}

export function isForbiddenQueryKey(key: string): boolean {
  return (FORBIDDEN_QUERY_KEYS as readonly string[]).includes(key.toLowerCase());
}

export function urlContainsCredentialParams(value: string | URL): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    for (const key of url.searchParams.keys()) {
      if (isForbiddenQueryKey(key)) return true;
    }
    if (url.hash.length > 1) {
      const hash = new URLSearchParams(url.hash.slice(1));
      for (const key of hash.keys()) {
        if (isForbiddenQueryKey(key)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Strip identity/session/device secrets from a launch URL. Never put them on an embed. */
export function sanitizeLaunchUrl(value: string): string {
  const url = parseHttpUrl(value);
  if (!url) return value;
  for (const key of [...url.searchParams.keys()]) {
    if (isForbiddenQueryKey(key)) url.searchParams.delete(key);
  }
  if (url.hash.length > 1) {
    const hash = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const key of [...hash.keys()]) {
      if (isForbiddenQueryKey(key)) {
        hash.delete(key);
        changed = true;
      }
    }
    url.hash = changed ? (hash.toString() ? `#${hash.toString()}` : "") : url.hash;
  }
  return url.toString();
}
