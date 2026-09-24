/**
 * Reachability probe for Experience entrypoints.
 * Used before iframe mount so a dead URL cannot paint WebView's white
 * "Webpage not available" error over the entire OS Xperience shell.
 */
export async function probeExperienceUrl(
  url: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; reason?: string }> {
  if (!url || typeof url !== "string") {
    return { ok: false, reason: "Experience entrypoint is missing." };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Experience entrypoint is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Experience entrypoint must be http(s)." };
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ok: false,
      reason: "This Experience needs a connection to continue. Your previous state has been preserved.",
    };
  }

  if (typeof fetch !== "function") {
    return { ok: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // no-cors: opaque 2xx/3xx/4xx still means the TCP path worked.
    // Network / DNS / socket failures reject — that is what we need.
    await fetch(parsed.toString(), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return { ok: true };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") {
      return {
        ok: false,
        reason: "This Experience took too long to respond. Returning to OS Xperience Home.",
      };
    }
    return {
      ok: false,
      reason: "This Experience could not be reached. Returning to OS Xperience Home.",
    };
  } finally {
    clearTimeout(timer);
  }
}
