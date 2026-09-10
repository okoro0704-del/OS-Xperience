import {
  DEVELOPER_CONTRACT_VERSION,
  OSSHELL_VERSION,
  SHELL_MESSAGE_VERSION,
} from "./version.js";

export interface OSShellCompatibility {
  protocol: string;
  contractVersion: string;
  shellVersion: string;
  supported: boolean;
  reason?: string;
}

export function shellCompatibility(input?: {
  requiredProtocol?: string;
  minContractVersion?: string;
}): OSShellCompatibility {
  const protocol = SHELL_MESSAGE_VERSION;
  const contractVersion = DEVELOPER_CONTRACT_VERSION;
  const shellVersion = OSSHELL_VERSION;
  if (input?.requiredProtocol && input.requiredProtocol !== protocol) {
    return {
      protocol,
      contractVersion,
      shellVersion,
      supported: false,
      reason: `application_incompatible: required protocol ${input.requiredProtocol}, Shell speaks ${protocol}.`,
    };
  }
  if (input?.minContractVersion && compareContract(contractVersion, input.minContractVersion) < 0) {
    return {
      protocol,
      contractVersion,
      shellVersion,
      supported: false,
      reason: `application_incompatible: app requires contract ${input.minContractVersion}, Shell offers ${contractVersion}.`,
    };
  }
  return { protocol, contractVersion, shellVersion, supported: true };
}

function compareContract(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb ? 0 : na > nb ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}
