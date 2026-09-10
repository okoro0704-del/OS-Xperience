export interface CapabilityAuditEntry {
  timestamp: string;
  origin: string;
  appId: string | null;
  capability: string;
  request:
    | "capability.request"
    | "capability.status"
    | "capability.execution"
    | "intent.request"
    | "intent.discover"
    | "intent.handoff"
    | "session.lifecycle"
    | "session.continuity"
    | "action.discover"
    | "action.request"
    | "search.query"
    | "objective.discover"
    | "objective.start"
    | "preference.get"
    | "preference.set"
    | "preference.clear"
    | "preference.list"
    | "objective.continue"
    | "continuity.recent"
    | "context.propose"
    | "handoff.ack";
  decision:
    | "prompt"
    | "grant"
    | "deny"
    | "revoke"
    | "blocked"
    | "unavailable"
    | "cancelled"
    | "duplicate"
    | "execution"
    | "intent_requested"
    | "handler_discovered"
    | "handler_selected"
    | "handoff_started"
    | "handoff_completed"
    | "handoff_denied"
    | "handoff_accepted"
    | "handoff_rejected"
    | "context_rejected"
    | "context_updated"
    | "context_cleared"
    | "continuation_started"
    | "continuation_unavailable"
    | "continuity_listed"
    | "session_created"
    | "session_activated"
    | "session_switched"
    | "session_joined"
    | "session_left"
    | "session_resumed"
    | "session_ended"
    | "intent_started"
    | "intent_completed"
    | "object_selected"
    | "action_discovered"
    | "action_requested"
    | "action_started"
    | "action_completed"
    | "action_cancelled"
    | "action_failed"
    | "search_started"
    | "search_completed"
    | "search_provider_timeout"
    | "search_provider_unavailable"
    | "search_result_selected"
    | "objective_discovered"
    | "objective_started"
    | "objective_cancelled"
    | "objective_unavailable"
    | "preference_set"
    | "preference_cleared"
    | "preference_listed";
  result: string;
  availability?: string;
  executionStarted?: boolean;
  executionResult?: string;
  /** Safe interoperability metadata only — never payload contents. */
  intent?: string;
  contextType?: string;
  targetAppId?: string | null;
  sessionId?: string | null;
  action?: string | null;
  searchScope?: string | null;
  resultCount?: number;
  objectiveType?: string | null;
}

export function capabilityAuditEntry(input: {
  origin: string;
  appId?: string | null;
  capability: string;
  decision: CapabilityAuditEntry["decision"];
  result: string;
  request?: CapabilityAuditEntry["request"];
  availability?: string;
  executionStarted?: boolean;
  executionResult?: string;
  intent?: string;
  contextType?: string;
  targetAppId?: string | null;
  sessionId?: string | null;
  action?: string | null;
  searchScope?: string | null;
  resultCount?: number;
  objectiveType?: string | null;
  now?: Date;
}): CapabilityAuditEntry {
  const sessionDecision =
    input.decision.startsWith("session_") ||
    input.decision === "intent_started" ||
    input.decision === "intent_completed";
  const actionDecision =
    input.decision.startsWith("action_") || input.decision === "object_selected";
  const searchDecision = input.decision.startsWith("search_");
  const objectiveDecision = input.decision.startsWith("objective_");
  const preferenceDecision = input.decision.startsWith("preference_");
  return {
    timestamp: (input.now ?? new Date()).toISOString(),
    origin: input.origin,
    appId: input.appId ?? null,
    capability: input.capability,
    request:
      input.request ??
      (input.decision === "execution"
        ? "capability.execution"
        : preferenceDecision
          ? input.decision === "preference_set"
            ? "preference.set"
            : input.decision === "preference_cleared"
              ? "preference.clear"
              : "preference.list"
          : objectiveDecision
            ? input.decision === "objective_discovered"
              ? "objective.discover"
              : "objective.start"
            : searchDecision
              ? "search.query"
              : actionDecision
                ? input.decision === "action_discovered"
                  ? "action.discover"
                  : "action.request"
                : sessionDecision
                  ? input.decision.startsWith("session_")
                    ? "session.lifecycle"
                    : "session.continuity"
                  : input.decision.startsWith("intent") ||
                      input.decision.startsWith("handler") ||
                      input.decision.startsWith("handoff") ||
                      input.decision === "context_rejected"
                    ? "intent.request"
                    : "capability.request"),
    decision: input.decision,
    result: input.result,
    availability: input.availability,
    executionStarted: input.executionStarted,
    executionResult: input.executionResult,
    intent: input.intent,
    contextType: input.contextType,
    targetAppId: input.targetAppId ?? null,
    sessionId: input.sessionId ?? null,
    action: input.action ?? null,
    searchScope: input.searchScope ?? null,
    resultCount: input.resultCount,
    objectiveType: input.objectiveType ?? null,
  };
}

export function intentAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    | "intent_requested"
    | "handler_discovered"
    | "handler_selected"
    | "handoff_started"
    | "handoff_completed"
    | "handoff_denied"
    | "context_rejected"
    | "intent_started"
    | "intent_completed"
  >;
  result: string;
  intent?: string;
  contextType?: string;
  targetAppId?: string | null;
  sessionId?: string | null;
  now?: Date;
}): CapabilityAuditEntry {
  return capabilityAuditEntry({
    ...input,
    capability: input.intent ?? "intent",
    request:
      input.decision === "handler_discovered"
        ? "intent.discover"
        : input.decision === "handoff_started" ||
            input.decision === "handoff_completed" ||
            input.decision === "intent_started" ||
            input.decision === "intent_completed"
          ? "intent.handoff"
          : "intent.request",
  });
}

export function sessionAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    | "session_created"
    | "session_activated"
    | "session_switched"
    | "session_joined"
    | "session_left"
    | "session_resumed"
    | "session_ended"
  >;
  result: string;
  sessionId?: string | null;
  contextType?: string;
  targetAppId?: string | null;
  now?: Date;
}): CapabilityAuditEntry {
  return capabilityAuditEntry({
    origin: input.origin,
    appId: input.appId,
    capability: "session",
    decision: input.decision,
    result: input.result,
    request: "session.lifecycle",
    sessionId: input.sessionId,
    contextType: input.contextType,
    targetAppId: input.targetAppId,
    now: input.now,
  });
}

export function actionAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    | "object_selected"
    | "action_discovered"
    | "action_requested"
    | "handler_selected"
    | "action_started"
    | "action_completed"
    | "action_cancelled"
    | "action_failed"
  >;
  result: string;
  action?: string | null;
  contextType?: string;
  targetAppId?: string | null;
  sessionId?: string | null;
  availability?: string;
  now?: Date;
}): CapabilityAuditEntry {
  return capabilityAuditEntry({
    origin: input.origin,
    appId: input.appId,
    capability: input.action ?? "action",
    decision: input.decision,
    result: input.result,
    request: input.decision === "action_discovered" ? "action.discover" : "action.request",
    action: input.action,
    intent: input.action ?? undefined,
    contextType: input.contextType,
    targetAppId: input.targetAppId,
    sessionId: input.sessionId,
    availability: input.availability,
    now: input.now,
  });
}

export function searchAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    | "search_started"
    | "search_completed"
    | "search_provider_timeout"
    | "search_provider_unavailable"
    | "search_result_selected"
  >;
  result: string;
  searchScope?: string | null;
  resultCount?: number;
  targetAppId?: string | null;
  now?: Date;
}): CapabilityAuditEntry {
  return capabilityAuditEntry({
    origin: input.origin,
    appId: input.appId,
    capability: "search",
    decision: input.decision,
    result: input.result,
    request: "search.query",
    searchScope: input.searchScope,
    resultCount: input.resultCount,
    targetAppId: input.targetAppId,
    now: input.now,
  });
}

export function objectiveAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    | "objective_discovered"
    | "objective_started"
    | "objective_cancelled"
    | "objective_unavailable"
  >;
  result: string;
  objectiveType?: string | null;
  targetAppId?: string | null;
  sessionId?: string | null;
  intent?: string;
  availability?: string;
  now?: Date;
}): CapabilityAuditEntry {
  return capabilityAuditEntry({
    origin: input.origin,
    appId: input.appId,
    capability: "objective",
    decision: input.decision,
    result: input.result,
    request: input.decision === "objective_discovered" ? "objective.discover" : "objective.start",
    objectiveType: input.objectiveType,
    targetAppId: input.targetAppId,
    sessionId: input.sessionId,
    intent: input.intent,
    availability: input.availability,
    now: input.now,
  });
}

export function preferenceAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    "preference_set" | "preference_cleared" | "preference_listed"
  >;
  result: string;
  objectiveType?: string | null;
  targetAppId?: string | null;
  now?: Date;
}): CapabilityAuditEntry {
  return capabilityAuditEntry({
    origin: input.origin,
    appId: input.appId,
    capability: "preference",
    decision: input.decision,
    result: input.result,
    request:
      input.decision === "preference_set"
        ? "preference.set"
        : input.decision === "preference_cleared"
          ? "preference.clear"
          : "preference.list",
    objectiveType: input.objectiveType,
    targetAppId: input.targetAppId,
    now: input.now,
  });
}

export function continuityAuditEntry(input: {
  origin: string;
  appId?: string | null;
  decision: Extract<
    CapabilityAuditEntry["decision"],
    | "context_updated"
    | "context_cleared"
    | "continuation_started"
    | "continuation_unavailable"
    | "continuity_listed"
    | "handoff_accepted"
    | "handoff_rejected"
  >;
  result: string;
  objectiveType?: string | null;
  targetAppId?: string | null;
  sessionId?: string | null;
  now?: Date;
}): CapabilityAuditEntry {
  const request: CapabilityAuditEntry["request"] =
    input.decision === "continuation_started" || input.decision === "continuation_unavailable"
      ? "objective.continue"
      : input.decision === "continuity_listed"
        ? "continuity.recent"
        : input.decision === "handoff_accepted" || input.decision === "handoff_rejected"
          ? "handoff.ack"
          : "context.propose";
  return capabilityAuditEntry({
    origin: input.origin,
    appId: input.appId,
    capability: "continuity",
    decision: input.decision,
    result: input.result,
    request,
    objectiveType: input.objectiveType,
    targetAppId: input.targetAppId,
    sessionId: input.sessionId,
    now: input.now,
  });
}
