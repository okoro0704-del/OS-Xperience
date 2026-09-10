import {
  parseTrustedMessage,
  type EnvelopeReject,
  type TrustedIncomingMessage,
} from "@osshell/contract";

export type HandshakeReject = EnvelopeReject | "application_not_registered" | "origin_not_trusted";

export function interpretAppEvent(input: {
  data: unknown;
  eventOrigin: string;
  eventSource: unknown;
  expectedOrigin: string;
  expectedSource: unknown;
  registered: boolean;
}): { ok: true; message: TrustedIncomingMessage } | { ok: false; code: HandshakeReject } {
  if (!input.registered) return { ok: false, code: "application_not_registered" };
  if (input.eventOrigin !== input.expectedOrigin) return { ok: false, code: "origin_not_trusted" };
  return parseTrustedMessage({
    data: input.data,
    eventOrigin: input.eventOrigin,
    eventSource: input.eventSource,
    expectedOrigin: input.expectedOrigin,
    expectedSource: input.expectedSource,
  });
}

export function sessionSourceOf(frame: { contentWindow: unknown } | null | undefined): unknown {
  return frame?.contentWindow ?? null;
}
