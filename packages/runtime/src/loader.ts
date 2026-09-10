import { decideLoad, type EmbedPolicy, type LoadDecision } from "@osshell/contract";

export function planLoad(input: {
  href: string;
  origin: string;
  preferEmbed: boolean;
  preferTopLevel?: boolean;
  manifestEmbed?: EmbedPolicy | null;
  native?: boolean;
}): LoadDecision {
  return decideLoad(input);
}

export function probeEmbedState(iframe: HTMLIFrameElement): "embedded" | "frame_blocked" {
  const win = iframe.contentWindow;
  if (!win) return "frame_blocked";
  try {
    const href = win.location.href;
    if (!href || href === "about:blank") return "frame_blocked";
    return "embedded";
  } catch {
    return "embedded";
  }
}

export function openNewContext(href: string, opener: (url: string, target: string, features: string) => Window | null = defaultOpen): boolean {
  const opened = opener(href, "_blank", "noopener,noreferrer");
  return Boolean(opened);
}

function defaultOpen(url: string, target: string, features: string): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(url, target, features);
}
