import type { OSShellIntentHandler } from "./intent-handlers.js";

/** Seeded handlers for the three-application interoperability test. Declaration ≠ privilege. */
export function defaultIntentHandlersFor(appId: string): OSShellIntentHandler[] {
  if (appId === "shell-demo-notes") {
    return [
      { intent: "view", contextTypes: ["text"], route: "/" },
      { intent: "edit", contextTypes: ["text"], route: "/" },
      { intent: "share", contextTypes: ["text"], route: "/" },
      { intent: "open", contextTypes: ["text"], route: "/" },
      { intent: "create", contextTypes: ["text"], route: "/" },
    ];
  }
  if (appId === "lifeos") {
    return [
      { intent: "view", contextTypes: ["asset", "url", "digital_life"], route: "/" },
      { intent: "open", contextTypes: ["asset", "url", "application", "digital_life"], route: "/" },
      { intent: "share", contextTypes: ["asset", "url", "text"], route: "/" },
    ];
  }
  if (appId === "mybrandos") {
    return [
      { intent: "view", contextTypes: ["asset", "media", "project"], route: "/" },
      { intent: "edit", contextTypes: ["asset", "media", "project", "document"], route: "/" },
      { intent: "publish", contextTypes: ["asset", "media", "project"], route: "/" },
      { intent: "open", contextTypes: ["asset", "project"], route: "/" },
      { intent: "create", contextTypes: ["project", "asset", "media", "text"], route: "/" },
    ];
  }
  return [];
}
