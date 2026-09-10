export const APPLICATION_RUNTIME_STATES = [
  "application_loading",
  "application_ready",
  "application_disconnected",
  "application_navigation_unavailable",
  "capability_denied",
  "permission_required",
  "permission_revoked",
  "origin_not_trusted",
  "application_not_registered",
] as const;

export type ApplicationRuntimeState = (typeof APPLICATION_RUNTIME_STATES)[number];

export function disconnectState(from: ApplicationRuntimeState | null): ApplicationRuntimeState {
  if (from === "application_ready" || from === "application_loading") return "application_disconnected";
  return from ?? "application_disconnected";
}
