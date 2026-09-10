export const CAPABILITIES = ["IDENTITY", "MESSAGING", "FILES", "PAYMENTS", "CAMERA", "DEVICE_BRIDGE", "LIVE", "COMMERCE", "NOTIFICATIONS"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const REVIEW_STATES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED", "PUBLISHED", "SUSPENDED", "REVOKED"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export const EVIDENCE_TYPES = ["DOMAIN", "WELL_KNOWN_ENDPOINT", "GITHUB", "DEPLOYMENT_PROVIDER", "XPERIENCE_ENDPOINT"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface ApplicationManifestClaim {
  schemaVersion: "1"; applicationId: string; name: string; version: string; origin: string;
  productionUrl: string; xperienceUrl: string; capabilities: Capability[];
  repository?: { provider: "GITHUB"; url: string }; deploymentClaims?: { provider: string; url: string }[];
}
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const forbidden = /password|private.?key|session.?cookie|biometric|payment.?credential|secret/i;
export function safeHttpsUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !isPrivateHost(url.hostname); } catch { return false; } }
function isPrivateHost(host: string): boolean { const h = host.toLowerCase(); return h === "localhost" || h === "::1" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h); }
export function validateManifest(input: unknown): ValidationResult<ApplicationManifestClaim> {
  if (!input || typeof input !== "object") return { ok:false, errors:["Manifest must be an object."] };
  const m = input as Record<string, unknown>; const errors: string[] = [];
  for (const key of ["applicationId", "name", "version", "origin", "productionUrl", "xperienceUrl"]) if (typeof m[key] !== "string" || !m[key]) errors.push(`${key} is required.`);
  if (m.schemaVersion !== "1") errors.push("Unsupported schemaVersion.");
  if (typeof m.origin !== "string" || !safeHttpsUrl(m.origin) || new URL(m.origin).pathname !== "/") errors.push("origin must be a public HTTPS origin.");
  for (const key of ["productionUrl", "xperienceUrl"]) if (typeof m[key] !== "string" || !safeHttpsUrl(m[key] as string)) errors.push(`${key} must be a public HTTPS URL.`);
  const capabilities = m.capabilities; if (!Array.isArray(capabilities) || capabilities.some(x => typeof x !== "string" || !(CAPABILITIES as readonly string[]).includes(x))) errors.push("Capabilities must use the Xperience allowlist.");
  if (forbidden.test(JSON.stringify(input))) errors.push("Manifest must not contain credentials or sensitive identity data.");
  return errors.length ? { ok:false, errors } : { ok:true, value:m as unknown as ApplicationManifestClaim };
}
export function reviewTransitionAllowed(from: ReviewState, to: ReviewState): boolean {
  const graph: Record<ReviewState, ReviewState[]> = { DRAFT:["SUBMITTED"], SUBMITTED:["UNDER_REVIEW","CHANGES_REQUIRED"], UNDER_REVIEW:["CHANGES_REQUIRED","APPROVED","SUSPENDED"], CHANGES_REQUIRED:["DRAFT","SUBMITTED"], APPROVED:["PUBLISHED","CHANGES_REQUIRED","SUSPENDED"], PUBLISHED:["SUSPENDED","REVOKED"], SUSPENDED:["APPROVED","REVOKED"], REVOKED:[] }; return graph[from].includes(to);
}
export interface XperienceHandshake { type: "DIGICONOMY_XPERIENCE_HANDSHAKE"; protocol: "1"; applicationId: string; origin: string; nonce: string; }
export interface XperienceReady { type: "DIGICONOMY_XPERIENCE_READY"; protocol: "1"; applicationId: string; nonce: string; }
export function validateHandshake(message: unknown, expected: { applicationId: string; origin: string }): ValidationResult<XperienceHandshake> { const m=message as Partial<XperienceHandshake>; if (!m || m.type !== "DIGICONOMY_XPERIENCE_HANDSHAKE" || m.protocol !== "1" || m.applicationId !== expected.applicationId || m.origin !== expected.origin || !m.nonce || !safeHttpsUrl(m.origin)) return { ok:false, errors:["Invalid Xperience handshake."] }; return { ok:true, value:m as XperienceHandshake }; }
export function isAllowedMessageOrigin(eventOrigin: string, applicationOrigin: string): boolean { return eventOrigin === applicationOrigin && safeHttpsUrl(eventOrigin); }
export interface ShellRegistryPort { resolveApplication(applicationId: string): Promise<{ applicationId: string; origin: string } | null>; }
