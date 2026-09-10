import { grantsLeakSecrets, jsonLeaksSecrets, type CapabilityAuditEntry, type PermissionDecision } from "@osshell/contract";

export class ClientDecisionStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  key(ownerKey = "ephemeral"): string {
    return `os-shell.decisions.${ownerKey}`;
  }

  load(ownerKey = "ephemeral"): PermissionDecision[] {
    const raw = this.storage.getItem(this.key(ownerKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as PermissionDecision[];
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) return [];
      return parsed.filter(
        (item) => item && typeof item.origin === "string" && typeof item.capability === "string" && (item.state === "DENIED" || item.state === "REVOKED"),
      );
    } catch {
      return [];
    }
  }

  save(decisions: readonly PermissionDecision[], ownerKey = "ephemeral"): void {
    if (jsonLeaksSecrets(decisions)) throw new Error("Permission decisions must not contain credentials.");
    this.storage.setItem(this.key(ownerKey), JSON.stringify(decisions));
  }
}

export class ClientAuditStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  key(ownerKey = "ephemeral"): string {
    return `os-shell.audit.${ownerKey}`;
  }

  load(ownerKey = "ephemeral"): CapabilityAuditEntry[] {
    const raw = this.storage.getItem(this.key(ownerKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as CapabilityAuditEntry[];
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed) || grantsLeakSecrets(parsed as never)) return [];
      return parsed.filter((item) => item && typeof item.origin === "string" && typeof item.capability === "string").slice(-100);
    } catch {
      return [];
    }
  }

  append(entry: CapabilityAuditEntry, ownerKey = "ephemeral"): CapabilityAuditEntry[] {
    if (jsonLeaksSecrets(entry)) return this.load(ownerKey);
    const next = [...this.load(ownerKey), entry].slice(-100);
    this.storage.setItem(this.key(ownerKey), JSON.stringify(next));
    return next;
  }
}
