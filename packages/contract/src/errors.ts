/** Developer-facing Shell error codes. Deterministic, documented, secret-free. */
export const SHELL_ERROR_CODES = [
  "shell_unavailable",
  "manifest_invalid",
  "origin_unverified",
  "origin_mismatch",
  "capability_unknown",
  "capability_denied",
  "capability_unavailable",
  "class_a_blocked",
  "permission_required",
  "application_not_registered",
  "application_not_verified",
  "application_disconnected",
  "application_incompatible",
  "application_not_installed",
  "application_duplicate",
  "unknown_application",
  "malformed_route",
  "handoff_rejected",
  "intent_unsupported",
  "no_handler",
  "context_invalid",
  "context_unavailable",
  "wildcard_rejected",
  "secret_payload",
  "simulation_only",
  "session_unknown",
  "session_ended",
  "session_unauthorized",
  "resume_unavailable",
  "action_unsupported",
  "action_unavailable",
  "search_query_invalid",
  "search_result_invalid",
  "provider_unavailable",
  "provider_timeout",
  "objective_invalid",
  "objective_not_understood",
  "objective_unavailable",
  "preference_invalid",
  "continuation_unavailable",
  "no_current_work",
] as const;

export type ShellErrorCode = (typeof SHELL_ERROR_CODES)[number];

export interface ShellError {
  code: ShellErrorCode;
  message: string;
  actionable: string;
}

export function shellError(code: ShellErrorCode, message: string, actionable: string): ShellError {
  return { code, message, actionable };
}

export function isShellErrorCode(value: string): value is ShellErrorCode {
  return (SHELL_ERROR_CODES as readonly string[]).includes(value);
}
