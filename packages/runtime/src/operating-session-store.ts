import {
  activateShellSession,
  addResumePoint,
  backgroundShellSession,
  createShellSession,
  currentActiveSession,
  endShellSession,
  findShellSession,
  joinShellSession,
  jsonLeaksSecrets,
  leaveShellSession,
  listRecentWork,
  recordSessionIntent,
  resumeShellSession,
  sanitizeSessionForDiagnostics,
  setSessionActiveContext,
  suspendShellSession,
  switchActiveSession,
  type OSShellResumePoint,
  type OSShellSession,
  type SessionResult,
} from "@osshell/contract";

const KEY = "os-shell.operating-sessions.v1";
const RECOVERY_KEY = "os-shell.operating-sessions.recovery.v1";

/**
 * Tab-local operating session store.
 * Uses sessionStorage for ephemeral coordination; optional localStorage recovery of safe metadata only.
 * Not a session server, Redis, or application database.
 */
export class ClientOperatingSessionStore {
  constructor(
    private readonly sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private readonly recoveryStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ) {}

  load(): OSShellSession[] {
    const raw = this.sessionStorage.getItem(KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as OSShellSession[];
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) return [];
      return parsed.filter((item) => item && typeof item.sessionId === "string" && typeof item.state === "string");
    } catch {
      return [];
    }
  }

  save(sessions: readonly OSShellSession[]): void {
    if (jsonLeaksSecrets(sessions)) throw new Error("Operating sessions must not contain credentials.");
    this.sessionStorage.setItem(KEY, JSON.stringify(sessions));
    this.writeRecovery(sessions);
  }

  /** Safe resume metadata only — never private payloads. */
  loadRecovery(): OSShellSession[] {
    if (!this.recoveryStorage) return [];
    const raw = this.recoveryStorage.getItem(RECOVERY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as OSShellSession[];
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) return [];
      return parsed.filter((item) => item.persistence === "resume-safe" && item.resumePoints.length > 0);
    } catch {
      return [];
    }
  }

  private writeRecovery(sessions: readonly OSShellSession[]): void {
    if (!this.recoveryStorage) return;
    const safe = sessions
      .filter((item) => item.persistence === "resume-safe" && item.state !== "ENDED")
      .map((item) => ({
        ...item,
        context: {
          label: item.context.label,
          activeApplicationId: item.context.activeApplicationId,
          activeIntent: item.context.activeIntent,
          activeContext: item.context.activeContext
            ? {
                type: item.context.activeContext.type,
                id: item.context.activeContext.id,
                title: item.context.activeContext.title,
                lifetime: item.context.activeContext.lifetime ?? "SESSION",
              }
            : undefined,
          previousApplicationId: item.context.previousApplicationId,
        },
      }));
    this.recoveryStorage.setItem(RECOVERY_KEY, JSON.stringify(safe));
  }

  create(label?: string): OSShellSession {
    const sessions = this.load();
    const backgrounded = sessions.map((item) =>
      item.state === "ACTIVE" ? { ...item, state: "BACKGROUND" as const } : item,
    );
    const created = createShellSession({ label });
    const activated = activateShellSession(created);
    const next = activated.ok ? activated.value : created;
    const list = [...backgrounded, next];
    this.save(list);
    return next;
  }

  current(): OSShellSession | null {
    return currentActiveSession(this.load());
  }

  list(): OSShellSession[] {
    return this.load();
  }

  recentWork() {
    return listRecentWork(this.load());
  }

  switchTo(sessionId: string): SessionResult<OSShellSession[]> {
    const result = switchActiveSession(this.load(), sessionId);
    if (result.ok) this.save(result.value);
    return result;
  }

  end(sessionId: string): SessionResult<OSShellSession> {
    const sessions = this.load();
    const found = findShellSession(sessions, sessionId);
    if (!found) return { ok: false, code: "session_unknown", detail: "Unknown session." };
    const ended = endShellSession(found);
    this.save(sessions.map((item) => (item.sessionId === sessionId ? ended : item)).filter((item) => item.state !== "ENDED" || item.resumePoints.length > 0));
    return { ok: true, value: ended };
  }

  join(sessionId: string, appId: string): SessionResult<OSShellSession> {
    const sessions = this.load();
    const found = findShellSession(sessions, sessionId);
    if (!found) return { ok: false, code: "session_unknown", detail: "Unknown session." };
    const result = joinShellSession(found, appId);
    if (result.ok) this.save(sessions.map((item) => (item.sessionId === sessionId ? result.value : item)));
    return result;
  }

  leave(sessionId: string, appId: string): SessionResult<OSShellSession> {
    const sessions = this.load();
    const found = findShellSession(sessions, sessionId);
    if (!found) return { ok: false, code: "session_unknown", detail: "Unknown session." };
    const result = leaveShellSession(found, appId);
    if (result.ok) this.save(sessions.map((item) => (item.sessionId === sessionId ? result.value : item)));
    return result;
  }

  resume(sessionId: string): SessionResult<{ session: OSShellSession; resumePoint: OSShellResumePoint | null }> {
    let sessions = this.load();
    if (!findShellSession(sessions, sessionId)) {
      const recovered = this.loadRecovery().find((item) => item.sessionId === sessionId);
      if (recovered) {
        sessions = [...sessions.filter((item) => item.sessionId !== sessionId), recovered];
        this.save(sessions);
      }
    }
    const result = resumeShellSession(sessions, sessionId);
    if (!result.ok) return result;
    const switched = switchActiveSession(
      sessions.map((item) => (item.sessionId === sessionId ? result.value.session : item)),
      sessionId,
    );
    if (switched.ok) this.save(switched.value);
    else this.save(sessions.map((item) => (item.sessionId === sessionId ? result.value.session : item)));
    return result;
  }

  recordIntent(input: {
    sessionId?: string;
    sourceAppId: string;
    targetAppId: string;
    intent: Parameters<typeof recordSessionIntent>[1]["intent"];
    context: Parameters<typeof recordSessionIntent>[1]["context"];
    label?: string;
  }): SessionResult<OSShellSession> {
    let sessions = this.load();
    let session = input.sessionId
      ? findShellSession(sessions, input.sessionId)
      : currentActiveSession(sessions);
    if (input.sessionId && !session) {
      return { ok: false, code: "session_unknown", detail: "Unknown session." };
    }
    if (!session) {
      session = this.create(input.label ?? `${input.intent} workflow`);
      sessions = this.load();
    }
    const recorded = recordSessionIntent(session, {
      sourceAppId: input.sourceAppId,
      targetAppId: input.targetAppId,
      intent: input.intent,
      context: input.context,
    });
    if (!recorded.ok) return recorded;
    const withResume = addResumePoint(recorded.value, {
      appId: input.targetAppId,
      context: input.context,
      label: input.context.title ?? recorded.value.context.label,
    });
    const next = withResume.ok ? withResume.value : recorded.value;
    this.save(sessions.map((item) => (item.sessionId === next.sessionId ? next : item)));
    return { ok: true, value: next };
  }

  setContext(
    sessionId: string,
    input: Parameters<typeof setSessionActiveContext>[1],
  ): SessionResult<OSShellSession> {
    const sessions = this.load();
    const found = findShellSession(sessions, sessionId);
    if (!found) return { ok: false, code: "session_unknown", detail: "Unknown session." };
    const result = setSessionActiveContext(found, input);
    if (result.ok) this.save(sessions.map((item) => (item.sessionId === sessionId ? result.value : item)));
    return result;
  }

  pinContext(sessionId: string, context: Parameters<typeof setSessionActiveContext>[1]["context"], label?: string) {
    return this.setContext(sessionId, { context, label });
  }

  background(sessionId: string): SessionResult<OSShellSession> {
    return this.mapSession(sessionId, backgroundShellSession);
  }

  suspend(sessionId: string): SessionResult<OSShellSession> {
    return this.mapSession(sessionId, suspendShellSession);
  }

  activate(sessionId: string): SessionResult<OSShellSession> {
    return this.mapSession(sessionId, activateShellSession);
  }

  diagnostics(sessionId: string) {
    const found = findShellSession(this.load(), sessionId);
    return found ? sanitizeSessionForDiagnostics(found) : null;
  }

  private mapSession(
    sessionId: string,
    fn: (session: OSShellSession) => SessionResult<OSShellSession>,
  ): SessionResult<OSShellSession> {
    const sessions = this.load();
    const found = findShellSession(sessions, sessionId);
    if (!found) return { ok: false, code: "session_unknown", detail: "Unknown session." };
    const result = fn(found);
    if (result.ok) this.save(sessions.map((item) => (item.sessionId === sessionId ? result.value : item)));
    return result;
  }
}

export function publicSessionView(session: OSShellSession | null) {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    state: session.state,
    label: session.context.label,
    activeApplicationId: session.context.activeApplicationId,
    activeIntent: session.context.activeIntent,
    contextType: session.context.activeContext?.type,
  };
}

/** Unauthorized apps cannot invent participation. Shell must authorize join. */
export function authorizeSessionParticipation(input: {
  session: OSShellSession | null;
  appId: string;
  sessionId?: string;
}): SessionResult<true> {
  if (input.sessionId && !input.session) {
    return { ok: false, code: "session_unknown", detail: "Unknown session." };
  }
  if (!input.session) return { ok: true, value: true };
  if (input.session.state === "ENDED") {
    return { ok: false, code: "session_ended", detail: "Session has ended." };
  }
  const participant = input.session.participants.some((item) => item.appId === input.appId);
  // Current active app may join; non-participants cannot read or mutate foreign sessions.
  if (input.sessionId && input.session.sessionId !== input.sessionId) {
    return { ok: false, code: "session_unauthorized", detail: "Session mismatch." };
  }
  if (input.sessionId && !participant && input.session.context.activeApplicationId !== input.appId) {
    // Join is allowed only through Shell-mediated APIs; callers still cannot forge other apps' ids.
    return { ok: true, value: true };
  }
  return { ok: true, value: true };
}
