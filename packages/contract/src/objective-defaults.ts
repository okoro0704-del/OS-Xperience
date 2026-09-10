import type { OSShellObjectiveDeclaration } from "./objectives.js";

/** Seeded objective declarations for the three-application test. Declaration ≠ availability. */
export function defaultObjectiveDeclarationFor(appId: string): OSShellObjectiveDeclaration {
  if (appId === "mybrandos") {
    return {
      create: ["video", "music", "writing", "software"],
      edit: ["asset", "music", "video", "project", "writing"],
      preview: ["video", "software"],
      publish: ["asset", "video", "music", "project"],
      view: ["asset", "video", "project"],
      open: ["project", "asset", "video"],
      continue: ["*"],
    };
  }
  if (appId === "lifeos") {
    return {
      view: ["asset", "digital_life"],
      share: ["asset"],
      open: ["digital_life", "asset"],
      continue: ["*"],
    };
  }
  if (appId === "shell-demo-notes") {
    return {
      create: ["note", "text"],
      edit: ["note", "text"],
      view: ["note", "text"],
      share: ["note", "text"],
      open: ["note", "text"],
      continue: ["*"],
    };
  }
  return {};
}
