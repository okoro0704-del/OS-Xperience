export const APP_LIFECYCLES = ["CLOSED", "OPEN", "ACTIVE", "BACKGROUND", "SUSPENDED"] as const;
export type AppLifecycle = (typeof APP_LIFECYCLES)[number];

export type AppKind = "url" | "application";

export function appKindFromClass(appClass: "web" | "compatible" | "native"): AppKind {
  return appClass === "web" ? "url" : "application";
}

export interface LifecycleRecord {
  origin: string;
  lifecycle: AppLifecycle;
}

export function openLifecycle(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  const rest = records
    .filter((item) => item.origin !== origin && item.lifecycle !== "CLOSED")
    .map((item) => ({ ...item, lifecycle: "BACKGROUND" as const }));
  return [...rest, { origin, lifecycle: "OPEN" }];
}

export function confirmReady(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  const current = records.find((item) => item.origin === origin && item.lifecycle !== "CLOSED");
  if (!current) return [...records];
  return records
    .filter((item) => item.lifecycle !== "CLOSED")
    .map((item) => ({
      origin: item.origin,
      lifecycle: item.origin === origin ? "ACTIVE" : "BACKGROUND",
    }));
}

export function activateLifecycle(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  const current = records.find((item) => item.origin === origin && item.lifecycle !== "CLOSED");
  if (!current) return openLifecycle(records, origin);
  const next: AppLifecycle = current.lifecycle === "OPEN" ? "OPEN" : "ACTIVE";
  return records
    .filter((item) => item.lifecycle !== "CLOSED")
    .map((item) => ({
      origin: item.origin,
      lifecycle: item.origin === origin ? next : "BACKGROUND",
    }));
}

export function disconnectLifecycle(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  return records.map((item) =>
    item.origin === origin && (item.lifecycle === "ACTIVE" || item.lifecycle === "OPEN")
      ? { ...item, lifecycle: "BACKGROUND" as const }
      : item,
  );
}

export function suspendLifecycle(records: readonly LifecycleRecord[]): LifecycleRecord[] {
  return records
    .filter((item) => item.lifecycle !== "CLOSED")
    .map((item) => ({
      origin: item.origin,
      lifecycle: item.lifecycle === "ACTIVE" || item.lifecycle === "BACKGROUND" ? "SUSPENDED" : item.lifecycle,
    }));
}

export function closeLifecycle(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  const remaining = records.filter((item) => item.origin !== origin && item.lifecycle !== "CLOSED");
  if (remaining.some((item) => item.lifecycle === "ACTIVE")) return remaining;
  if (remaining[0]) {
    return remaining.map((item, index) => ({ ...item, lifecycle: index === remaining.length - 1 ? "ACTIVE" : item.lifecycle }));
  }
  return remaining;
}

export function lifecycleFor(records: readonly LifecycleRecord[], origin: string): AppLifecycle {
  return records.find((item) => item.origin === origin)?.lifecycle ?? "CLOSED";
}
