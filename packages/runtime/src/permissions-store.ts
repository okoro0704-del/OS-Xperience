import type { PermissionGrant } from "@osshell/contract";
import { grantsLeakSecrets } from "@osshell/contract";

const PREFIX = "os-shell.grants.";

export class ClientGrantStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  key(ownerKey = "ephemeral"): string {
    return `${PREFIX}${ownerKey}`;
  }

  load(ownerKey = "ephemeral"): PermissionGrant[] {
    const raw = this.storage.getItem(this.key(ownerKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as PermissionGrant[];
      if (!Array.isArray(parsed) || grantsLeakSecrets(parsed)) return [];
      return parsed.filter((item) => item && typeof item.origin === "string" && typeof item.capability === "string");
    } catch {
      return [];
    }
  }

  save(grants: readonly PermissionGrant[], ownerKey = "ephemeral"): void {
    if (grantsLeakSecrets(grants)) {
      throw new Error("Grants must not contain credentials.");
    }
    this.storage.setItem(this.key(ownerKey), JSON.stringify(grants));
  }

  clear(ownerKey = "ephemeral"): void {
    this.storage.removeItem(this.key(ownerKey));
  }
}
