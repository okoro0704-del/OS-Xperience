import type { AppClass } from "./identity.js";
import type { PublicCapability } from "./capability-registry.js";
import type { ApplicationTrustState } from "./trust.js";
import type { DiscoverableCapabilityStatus } from "./discovery.js";
import { DEVELOPER_CONTRACT_VERSION, OSSHELL_VERSION, SHELL_MESSAGE_VERSION } from "./version.js";

/** Safe developer diagnostics. No secrets or infrastructure topology. */
export interface ShellDeveloperDiagnostics {
  application: string;
  origin: string;
  trustClass: AppClass;
  trustState: ApplicationTrustState;
  manifestVersion: string | null;
  requestedCapabilities: PublicCapability[];
  availableCapabilities: PublicCapability[];
  grantedCapabilities: PublicCapability[];
  deniedCapabilities: PublicCapability[];
  unavailableCapabilities: PublicCapability[];
  protocolVersion: typeof SHELL_MESSAGE_VERSION;
  shellVersion: typeof OSSHELL_VERSION;
  developerContractVersion: typeof DEVELOPER_CONTRACT_VERSION;
}

export function buildDeveloperDiagnostics(input: {
  application: string;
  origin: string;
  trustClass: AppClass;
  trustState: ApplicationTrustState;
  manifestVersion?: string | null;
  requested: readonly PublicCapability[];
  discovery: readonly { id: PublicCapability; status: DiscoverableCapabilityStatus }[];
}): ShellDeveloperDiagnostics {
  const by = (status: DiscoverableCapabilityStatus) =>
    input.discovery.filter((item) => item.status === status).map((item) => item.id);
  return {
    application: input.application,
    origin: input.origin,
    trustClass: input.trustClass,
    trustState: input.trustState,
    manifestVersion: input.manifestVersion ?? null,
    requestedCapabilities: [...input.requested],
    availableCapabilities: [...by("available"), ...by("permission_required"), ...by("granted")],
    grantedCapabilities: by("granted"),
    deniedCapabilities: by("denied"),
    unavailableCapabilities: [...by("unavailable"), ...by("class_a_blocked")],
    protocolVersion: SHELL_MESSAGE_VERSION,
    shellVersion: OSSHELL_VERSION,
    developerContractVersion: DEVELOPER_CONTRACT_VERSION,
  };
}
