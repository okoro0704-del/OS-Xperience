import type { EmbedPolicy } from "./manifest.js";

export type LoadMode = "new_context" | "top_level" | "embed";

export type LoadReason = "ordinary_default" | "embed_requested" | "embed_denied" | "native_launch" | "user_top_level";

export type EmbedState = "idle" | "probing" | "embedded" | "frame_blocked";

export interface LoadDecision {
  href: string;
  origin: string;
  mode: LoadMode;
  reason: LoadReason;
  detail: string;
}

export function decideLoad(input: {
  href: string;
  origin: string;
  preferEmbed: boolean;
  preferTopLevel?: boolean;
  manifestEmbed?: EmbedPolicy | null;
  native?: boolean;
}): LoadDecision {
  if (input.preferTopLevel) {
    return {
      href: input.href,
      origin: input.origin,
      mode: "top_level",
      reason: "user_top_level",
      detail: "Open as a normal page. Leaves the Shell.",
    };
  }
  if (input.preferEmbed && input.manifestEmbed === "deny") {
    return {
      href: input.href,
      origin: input.origin,
      mode: "new_context",
      reason: "embed_denied",
      detail: "This origin forbids iframe embed. Opening a new browsing context.",
    };
  }
  if (input.preferEmbed) {
    return {
      href: input.href,
      origin: input.origin,
      mode: "embed",
      reason: input.native ? "native_launch" : "embed_requested",
      detail: "Attempting iframe embed. Sites that send X-Frame-Options or CSP frame-ancestors will report frame_blocked.",
    };
  }
  return {
    href: input.href,
    origin: input.origin,
    mode: "new_context",
    reason: input.native ? "native_launch" : "ordinary_default",
    detail: "Ordinary web apps load in a new browsing context. The Shell grants no capabilities.",
  };
}
