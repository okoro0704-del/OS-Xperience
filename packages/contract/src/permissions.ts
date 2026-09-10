import type { ShellCapability } from "./capabilities.js";

export interface PermissionGrant {
  origin: string;
  capability: ShellCapability;
  scope: string;
  issuedAt: string;
  expiresAt?: string;
}

const SECRET_KEYS = [
  "token",
  "tokenhash",
  "trustid",
  "trustidtoken",
  "session",
  "devicetoken",
  "apikey",
  "streamkey",
  "refresh_token",
  "refreshtoken",
  "access_token",
  "accesstoken",
  "authorization",
  "privatekey",
  "secret",
  "credential",
  "password",
  "biometric",
  "walletkey",
];

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function jsonLeaksSecrets(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(jsonLeaksSecrets);
  if (typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.includes(normalizeKey(key)) || SECRET_KEYS.includes(key)) return true;
    if (jsonLeaksSecrets(nested)) return true;
  }
  return false;
}

export function grantsForOrigin(grants: readonly PermissionGrant[], origin: string): PermissionGrant[] {
  return grants.filter((grant) => grant.origin === origin);
}

export function createGrant(input: {
  origin: string;
  capability: ShellCapability;
  scope?: string;
  now?: Date;
  expiresAt?: string;
}): PermissionGrant {
  return {
    origin: input.origin,
    capability: input.capability,
    scope: input.scope ?? "",
    issuedAt: (input.now ?? new Date()).toISOString(),
    expiresAt: input.expiresAt,
  };
}

export function grantIsActive(grant: PermissionGrant, now = new Date()): boolean {
  if (!grant.expiresAt) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

export function hasGrant(grants: readonly PermissionGrant[], origin: string, capability: ShellCapability, now = new Date()): boolean {
  return grants.some((grant) => grant.origin === origin && grant.capability === capability && grantIsActive(grant, now));
}

export function revokeGrant(grants: readonly PermissionGrant[], origin: string, capability?: ShellCapability): PermissionGrant[] {
  return grants.filter((grant) => {
    if (grant.origin !== origin) return true;
    if (!capability) return false;
    return grant.capability !== capability;
  });
}

export function grantsLeakSecrets(grants: readonly PermissionGrant[]): boolean {
  return jsonLeaksSecrets(grants);
}
