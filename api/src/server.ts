import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CAPABILITIES,
  EVIDENCE_TYPES,
  REVIEW_STATES,
  type Capability,
  type CapabilityReviewState,
  type EvidenceType,
  type ReviewState,
} from "@digiconomy/xperience-contract";
import { DevelopmentAuthenticationProvider, productionAuthProvider, type AuthenticationProvider } from "./auth.js";
import { DomainError, XperienceService, type Actor } from "./domain.js";
import { closePrisma, prismaClient } from "./prisma.js";
import {
  createApplicationRepository,
  resolveRepositoryMode,
  type ApplicationRepository,
} from "./repository.js";
import { VerificationService } from "./verification.js";

export interface ApiRuntime {
  service: XperienceService;
  auth: AuthenticationProvider;
  repository: ApplicationRepository;
}

export function createRuntime(overrides?: {
  repository?: ApplicationRepository;
  auth?: AuthenticationProvider;
  verification?: VerificationService;
}): ApiRuntime {
  const mode = overrides?.repository ? undefined : resolveRepositoryMode();
  const repository =
    overrides?.repository ??
    createApplicationRepository(mode!, mode === "prisma" ? prismaClient() : undefined);
  const auth =
    overrides?.auth ??
    (process.env.NODE_ENV === "development" && process.env.XPERIENCE_DEV_AUTH === "true"
      ? new DevelopmentAuthenticationProvider(true)
      : productionAuthProvider());
  const verification = overrides?.verification ?? new VerificationService();
  return {
    repository,
    auth,
    service: new XperienceService(repository, verification),
  };
}

function allowedOrigins(): Set<string> {
  return new Set((process.env.XPERIENCE_CONSOLE_ORIGINS ?? "http://localhost:5174").split(",").map((s) => s.trim()));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new DomainError("Payload too large.");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("Invalid JSON body.");
  }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function statusFor(error: DomainError): number {
  switch (error.code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    default:
      return 400;
  }
}

function isReviewState(value: unknown): value is ReviewState {
  return typeof value === "string" && (REVIEW_STATES as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === "string" && (EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function createApiServer(runtime: ApiRuntime = createRuntime()): Server {
  const allowed = allowedOrigins();
  const { service, auth } = runtime;

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Xperience-Dev-Actor,X-Xperience-Dev-Email");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const path = (req.url ?? "").split("?")[0] ?? "";
    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { status: "ok", service: "xperience-api" });
    }

    const actor = await auth.authenticate(req.headers);
    if (!actor) return send(res, 401, { error: "authentication_required" });

    try {
      await route(req, res, path, actor, service);
    } catch (error) {
      if (error instanceof DomainError) return send(res, statusFor(error), { error: error.message, code: error.code });
      return send(res, 400, { error: error instanceof Error ? error.message : "invalid_request" });
    }
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actor: Actor,
  service: XperienceService,
): Promise<void> {
  if (req.method === "GET" && path === "/v1/me") {
    if (actor.role === "DEVELOPER") {
      const profile = await service.ensureDeveloperProfile(actor);
      return send(res, 200, { ...profile, role: actor.role });
    }
    return send(res, 200, { id: actor.id, role: actor.role, email: actor.email ?? null });
  }

  if (req.method === "GET" && path === "/v1/applications") {
    return send(res, 200, { applications: await service.listMine(actor) });
  }

  if (req.method === "POST" && path === "/v1/applications") {
    return send(res, 201, await service.register(actor, await readBody(req)));
  }

  if (req.method === "GET" && path === "/v1/admin/queue") {
    return send(res, 200, { applications: await service.listReviewQueue(actor) });
  }

  if (req.method === "GET" && path === "/v1/admin/audit") {
    return send(res, 200, { events: await service.listAudit(actor) });
  }

  const adminMatch = path.match(
    /^\/v1\/admin\/applications\/([^/]+)(?:\/(evidence|audit|capabilities|actions\/([^/]+)))?$/,
  );
  if (adminMatch) {
    const [, id, op, action] = adminMatch;
    if (req.method === "GET" && !op) return send(res, 200, await service.get(actor, id));
    if (req.method === "GET" && op === "evidence") return send(res, 200, { evidence: await service.listEvidence(actor, id) });
    if (req.method === "GET" && op === "audit") return send(res, 200, { events: await service.listAudit(actor, id) });
    if (req.method === "POST" && op === "capabilities") {
      const body = (await readBody(req)) as Record<string, unknown>;
      if (!isCapability(body.capability)) throw new DomainError("Invalid capability.");
      const status = body.status as Exclude<CapabilityReviewState, "REQUESTED">;
      if (!["APPROVED", "REJECTED", "REQUIRES_CHANGES"].includes(status)) {
        throw new DomainError("Invalid capability review status.");
      }
      return send(
        res,
        200,
        await service.reviewCapability(actor, id, body.capability, status, typeof body.reason === "string" ? body.reason : undefined),
      );
    }
    if (req.method === "POST" && action) {
      const body = (await readBody(req)) as { reason?: string };
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const map: Record<string, ReviewState | "reject"> = {
        "start-review": "UNDER_REVIEW",
        "request-changes": "CHANGES_REQUIRED",
        approve: "APPROVED",
        reject: "reject",
        publish: "PUBLISHED",
        suspend: "SUSPENDED",
        revoke: "REVOKED",
      };
      const target = map[action];
      if (!target) throw new DomainError("Unknown admin action.", "not_found");
      if (target === "reject") return send(res, 200, await service.reject(actor, id, reason));
      return send(res, 200, await service.transition(actor, id, target, reason));
    }
  }

  const appMatch = path.match(
    /^\/v1\/applications\/([^/]+)(?:\/(manifest|evidence|submit|review-status|capabilities|transition))?$/,
  );
  if (!appMatch) {
    send(res, 404, { error: "not_found" });
    return;
  }

  const [, id, operation] = appMatch;
  if (req.method === "GET" && !operation) return send(res, 200, await service.get(actor, id));
  if (req.method === "GET" && operation === "evidence") {
    return send(res, 200, { evidence: await service.listEvidence(actor, id) });
  }
  if (req.method === "GET" && operation === "review-status") {
    const app = await service.get(actor, id);
    return send(res, 200, { applicationId: app.id, state: app.state, revision: app.revision });
  }
  if (req.method === "POST" && operation === "submit") {
    return send(res, 200, await service.transition(actor, id, "SUBMITTED"));
  }
  if (req.method === "PATCH" && operation === "manifest") {
    return send(res, 200, await service.updateManifest(actor, id, await readBody(req)));
  }
  if (req.method === "POST" && operation === "evidence") {
    const body = (await readBody(req)) as Record<string, unknown>;
    if (!isEvidenceType(body.type) || typeof body.locator !== "string") {
      throw new DomainError("Evidence type and locator are required.");
    }
    const result = await service.addEvidence(actor, id, body.type, body.locator);
    return send(res, 202, result);
  }
  if (req.method === "POST" && operation === "transition") {
    const body = (await readBody(req)) as Record<string, unknown>;
    if (!isReviewState(body.state)) throw new DomainError("Invalid review state.");
    return send(
      res,
      200,
      await service.transition(actor, id, body.state, typeof body.reason === "string" ? body.reason : undefined),
    );
  }
  if (req.method === "POST" && operation === "capabilities") {
    // Developer capability declaration is expressed by revising the manifest.
    return send(res, 200, await service.updateManifest(actor, id, await readBody(req)));
  }

  send(res, 405, { error: "method_not_allowed" });
}

const isMain = process.argv[1] && /server\.(ts|js)$/.test(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const server = createApiServer();
  const port = Number(process.env.PORT ?? 4100);
  server.listen(port, () => {
    console.log(`xperience-api listening on ${port}`);
  });
  process.on("SIGTERM", () => server.close(() => void closePrisma()));
}
