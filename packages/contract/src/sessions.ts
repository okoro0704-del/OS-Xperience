/**
 * Operating session / continuity contract (1.4).
 * Shell owns operating context. Applications own application state.
 * Session ≠ authentication ≠ authorization ≠ application database.
 */
import { jsonLeaksSecrets } from "./permissions.js";
import {
  validateContextReference,
  type OSShellContextReference,
} from "./intent-context.js";
import type { OSShellIntent } from "./intent-handlers.js";

export const OS_SHELL_SESSION_STATES = [
  "CREATED",
  "ACTIVE",
  "BACKGROUND",
  "SUSPENDED",
  "ENDED",
] as const;

export type OSShellSessionState = (typeof OS_SHELL_SESSION_STATES)[number];

export interface OSShellSessionParticipant {
  appId: string;
  joinedAt: string;
  lastActiveAt?: string;
}

export interface OSShellSessionContext {
  activeApplicationId?: string;
  activeIntent?: OSShellIntent;
  activeContext?: OSShellContextReference;
  previousApplicationId?: string;
  /** Display label only — never private application state. */
  label?: string;
}

export interface OSShellResumePoint {
  appId: string;
  route?: string;
  context?: OSShellContextReference;
  label?: string;
  createdAt: string;
}

export interface OSShellResumeDescriptor {
  label: string;
  route?: string;
  context?: OSShellContextReference;
}

export interface OSShellSession {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  state: OSShellSessionState;
  context: OSShellSessionContext;
  participants: OSShellSessionParticipant[];
  resumePoints: OSShellResumePoint[];
  /** Session-only by default. Never a permanent behavioral database. */
  persistence: "session-only" | "resume-safe";
}

export type SessionReject =
  | "session_unknown"
  | "session_ended"
  | "session_unauthorized"
  | "resume_unavailable"
  | "context_invalid"
  | "context_unavailable"
  | "secret_payload"
  | "malformed_payload"
  | "unknown_application";

export type SessionResult<T> = { ok: true; value: T } | { ok: false; code: SessionReject; detail: string };

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createShellSession(input?: {
  label?: string;
  now?: Date;
  persistence?: OSShellSession["persistence"];
}): OSShellSession {
  const at = (input?.now ?? new Date()).toISOString();
  return {
    sessionId: newId("sess"),
    startedAt: at,
    updatedAt: at,
    state: "CREATED",
    context: { label: input?.label },
    participants: [],
    resumePoints: [],
    persistence: input?.persistence ?? "session-only",
  };
}

export function activateShellSession(session: OSShellSession, now = new Date()): SessionResult<OSShellSession> {
  if (session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Ended sessions cannot be activated." };
  }
  return {
    ok: true,
    value: {
      ...session,
      state: "ACTIVE",
      updatedAt: now.toISOString(),
    },
  };
}

export function backgroundShellSession(session: OSShellSession, now = new Date()): SessionResult<OSShellSession> {
  if (session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Ended sessions cannot be backgrounded." };
  }
  return {
    ok: true,
    value: {
      ...session,
      state: session.state === "CREATED" ? "CREATED" : "BACKGROUND",
      updatedAt: now.toISOString(),
    },
  };
}

export function suspendShellSession(session: OSShellSession, now = new Date()): SessionResult<OSShellSession> {
  if (session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Ended sessions cannot be suspended." };
  }
  return {
    ok: true,
    value: {
      ...session,
      state: "SUSPENDED",
      updatedAt: now.toISOString(),
    },
  };
}

export function endShellSession(session: OSShellSession, now = new Date()): OSShellSession {
  return {
    ...session,
    state: "ENDED",
    updatedAt: now.toISOString(),
    context: {},
    // Keep resume-safe points only when explicitly allowed; otherwise clear.
    resumePoints: session.persistence === "resume-safe" ? session.resumePoints : [],
    participants: [],
  };
}

export function joinShellSession(
  session: OSShellSession,
  appId: string,
  now = new Date(),
): SessionResult<OSShellSession> {
  if (session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Cannot join an ended session." };
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(appId)) {
    return { ok: false, code: "unknown_application", detail: "Invalid appId." };
  }
  const at = now.toISOString();
  const existing = session.participants.find((item) => item.appId === appId);
  const participants = existing
    ? session.participants.map((item) =>
        item.appId === appId ? { ...item, lastActiveAt: at } : item,
      )
    : [...session.participants, { appId, joinedAt: at, lastActiveAt: at }];
  return {
    ok: true,
    value: {
      ...session,
      participants,
      updatedAt: at,
      context: {
        ...session.context,
        previousApplicationId: session.context.activeApplicationId,
        activeApplicationId: appId,
      },
      state: session.state === "CREATED" ? "ACTIVE" : "ACTIVE",
    },
  };
}

export function leaveShellSession(
  session: OSShellSession,
  appId: string,
  now = new Date(),
): SessionResult<OSShellSession> {
  if (session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Session already ended." };
  }
  const participants = session.participants.filter((item) => item.appId !== appId);
  const context = { ...session.context };
  if (context.activeApplicationId === appId) {
    context.previousApplicationId = appId;
    context.activeApplicationId = participants[participants.length - 1]?.appId;
  }
  return {
    ok: true,
    value: {
      ...session,
      participants,
      context,
      updatedAt: now.toISOString(),
    },
  };
}

export function setSessionActiveContext(
  session: OSShellSession,
  input: {
    appId?: string;
    intent?: OSShellIntent;
    context?: unknown;
    label?: string;
  },
  now = new Date(),
): SessionResult<OSShellSession> {
  if (session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Cannot update an ended session." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Session context must not contain secrets." };
  }
  let activeContext: OSShellContextReference | undefined;
  if (input.context != null) {
    const validated = validateContextReference(input.context);
    if (!validated.ok) {
      return {
        ok: false,
        code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
        detail: validated.detail,
      };
    }
    // Store reference only — never bytes. Force EPHEMERAL unless already SESSION.
    activeContext = {
      ...validated.context,
      lifetime: validated.context.lifetime === "PERSISTED_REFERENCE" ? "SESSION" : validated.context.lifetime ?? "EPHEMERAL",
    };
  }
  return {
    ok: true,
    value: {
      ...session,
      updatedAt: now.toISOString(),
      state: session.state === "CREATED" ? "ACTIVE" : session.state,
      context: {
        ...session.context,
        activeApplicationId: input.appId ?? session.context.activeApplicationId,
        activeIntent: input.intent ?? session.context.activeIntent,
        activeContext: activeContext ?? session.context.activeContext,
        label: input.label ?? session.context.label,
      },
    },
  };
}

export function recordSessionIntent(
  session: OSShellSession,
  input: {
    sourceAppId: string;
    targetAppId: string;
    intent: OSShellIntent;
    context: OSShellContextReference;
  },
  now = new Date(),
): SessionResult<OSShellSession> {
  let next = session;
  const joinedSource = joinShellSession(next, input.sourceAppId, now);
  if (!joinedSource.ok) return joinedSource;
  next = joinedSource.value;
  const joinedTarget = joinShellSession(next, input.targetAppId, now);
  if (!joinedTarget.ok) return joinedTarget;
  next = joinedTarget.value;
  return setSessionActiveContext(
    next,
    {
      appId: input.targetAppId,
      intent: input.intent,
      context: input.context,
      label: session.context.label ?? `${input.intent} · ${input.context.type}`,
    },
    now,
  );
}

export function addResumePoint(
  session: OSShellSession,
  point: Omit<OSShellResumePoint, "createdAt"> & { createdAt?: string },
  now = new Date(),
): SessionResult<OSShellSession> {
  if (session.state === "ENDED" && session.persistence !== "resume-safe") {
    return { ok: false, code: "session_ended", detail: "Cannot add resume points to an ended session-only session." };
  }
  if (jsonLeaksSecrets(point)) {
    return { ok: false, code: "secret_payload", detail: "Resume points must not contain secrets." };
  }
  if (point.context) {
    const validated = validateContextReference(point.context);
    if (!validated.ok) {
      return {
        ok: false,
        code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
        detail: validated.detail,
      };
    }
  }
  const resume: OSShellResumePoint = {
    appId: point.appId,
    route: point.route,
    context: point.context,
    label: point.label,
    createdAt: point.createdAt ?? now.toISOString(),
  };
  const rest = session.resumePoints.filter((item) => item.appId !== resume.appId);
  return {
    ok: true,
    value: {
      ...session,
      persistence: "resume-safe",
      resumePoints: [resume, ...rest].slice(0, 8),
      updatedAt: now.toISOString(),
    },
  };
}

export function resumeShellSession(
  sessions: readonly OSShellSession[],
  sessionId: string,
  now = new Date(),
): SessionResult<{ session: OSShellSession; resumePoint: OSShellResumePoint | null }> {
  const found = sessions.find((item) => item.sessionId === sessionId);
  if (!found) return { ok: false, code: "session_unknown", detail: "Unknown session." };
  if (found.state === "ENDED" && found.resumePoints.length === 0) {
    return { ok: false, code: "resume_unavailable", detail: "No safe resume point remains." };
  }
  const activated = activateShellSession(
    found.state === "ENDED"
      ? {
          ...found,
          state: "SUSPENDED",
          context: {
            activeApplicationId: found.resumePoints[0]?.appId,
            activeContext: found.resumePoints[0]?.context,
            label: found.resumePoints[0]?.label ?? found.context.label,
          },
        }
      : found,
    now,
  );
  if (!activated.ok) return activated;
  return {
    ok: true,
    value: {
      session: activated.value,
      resumePoint: activated.value.resumePoints[0] ?? null,
    },
  };
}

export function switchActiveSession(
  sessions: readonly OSShellSession[],
  sessionId: string,
  now = new Date(),
): SessionResult<OSShellSession[]> {
  const target = sessions.find((item) => item.sessionId === sessionId);
  if (!target) return { ok: false, code: "session_unknown", detail: "Unknown session." };
  if (target.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Cannot switch to an ended session." };
  }
  const next = sessions.map((item) => {
    if (item.sessionId === sessionId) {
      return { ...item, state: "ACTIVE" as const, updatedAt: now.toISOString() };
    }
    if (item.state === "ACTIVE") {
      return { ...item, state: "BACKGROUND" as const, updatedAt: now.toISOString() };
    }
    return item;
  });
  return { ok: true, value: next };
}

export function findShellSession(
  sessions: readonly OSShellSession[],
  sessionId: string,
): OSShellSession | null {
  return sessions.find((item) => item.sessionId === sessionId) ?? null;
}

export function currentActiveSession(sessions: readonly OSShellSession[]): OSShellSession | null {
  return sessions.find((item) => item.state === "ACTIVE") ?? null;
}

export function sanitizeSessionForDiagnostics(session: OSShellSession): {
  sessionId: string;
  state: OSShellSessionState;
  label?: string;
  activeApplicationId?: string;
  activeIntent?: string;
  contextType?: string;
  participants: string[];
  resumeCount: number;
} {
  return {
    sessionId: session.sessionId,
    state: session.state,
    label: session.context.label,
    activeApplicationId: session.context.activeApplicationId,
    activeIntent: session.context.activeIntent,
    contextType: session.context.activeContext?.type,
    participants: session.participants.map((item) => item.appId),
    resumeCount: session.resumePoints.length,
  };
}

/** Doctrine helpers — encoded for tests and docs. */
export function sessionIsNotAuthentication(): true {
  return true;
}

export function sessionIsNotAuthorization(): true {
  return true;
}

export function sessionIsNotApplicationDatabase(): true {
  return true;
}

export function sessionDoesNotOwnApplicationData(): true {
  return true;
}

export function validateSessionId(value: unknown): value is string {
  return typeof value === "string" && /^sess-[a-z0-9]+-[a-z0-9]+$/i.test(value);
}

export function listRecentWork(sessions: readonly OSShellSession[]): Array<{
  sessionId: string;
  label: string;
  appId?: string;
  contextType?: string;
  state: OSShellSessionState;
}> {
  return sessions
    .filter((item) => item.state !== "ENDED")
    .map((item) => ({
      sessionId: item.sessionId,
      label: item.context.label ?? item.resumePoints[0]?.label ?? "Untitled session",
      appId: item.context.activeApplicationId ?? item.resumePoints[0]?.appId,
      contextType: item.context.activeContext?.type ?? item.resumePoints[0]?.context?.type,
      state: item.state,
    }));
}
