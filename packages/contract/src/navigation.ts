export type NavigationKind = "shell" | "application" | "external";

export type BackOwner = "application" | "shell" | "browser";

export function classifyNavigation(input: {
  shellSurface: boolean;
  appClass: "web" | "compatible" | "native" | null;
}): NavigationKind {
  if (input.shellSurface) return "shell";
  if (input.appClass === "web" || input.appClass === null) return "external";
  return "application";
}

/**
 * Application history stays in the application. Shell history is only the operating surface.
 * Browser history is last.
 */
export function decideBack(input: { appCanGoBack: boolean; shellHasHistory: boolean; kind: NavigationKind }): BackOwner {
  if (input.kind === "application" && input.appCanGoBack) return "application";
  if (input.shellHasHistory) return "shell";
  return "browser";
}
