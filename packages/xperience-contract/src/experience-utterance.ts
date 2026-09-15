/**
 * Deterministic OS Experience utterance routing.
 * Interaction surface only — not authorization, not an AI planner, not a workflow backend.
 * Resolves natural phrases onto Directory / Experience actions.
 */

/** Mirrors Directory categories without circular imports from index. */
export type ExperienceRouteCategory =
  | "Creator"
  | "Finance"
  | "Lifestyle"
  | "Education"
  | "Health"
  | "Development"
  | "Commerce"
  | "Identity"
  | "Productivity"
  | "Device"
  | "Notifications"
  | "General";

export type ExperienceUtterance =
  | { kind: "show_experience" }
  | { kind: "open"; query: string }
  | { kind: "start_experience"; query: string }
  | { kind: "search"; query: string }
  | { kind: "category"; category: ExperienceRouteCategory }
  | { kind: "unresolved"; text: string };

const CATEGORY_ALIASES: Record<string, ExperienceRouteCategory> = {
  finance: "Finance",
  financial: "Finance",
  money: "Finance",
  creator: "Creator",
  creators: "Creator",
  lifestyle: "Lifestyle",
  education: "Education",
  edu: "Education",
  health: "Health",
  wellness: "Health",
  development: "Development",
  developer: "Development",
  commerce: "Commerce",
  shopping: "Commerce",
  identity: "Identity",
  productivity: "Productivity",
  device: "Device",
  notifications: "Notifications",
};

function clean(text: string): string {
  return text
    .trim()
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ");
}

export function parseExperienceUtterance(input: string): ExperienceUtterance {
  const text = clean(input);
  if (!text) return { kind: "unresolved", text: input };

  const lower = text.toLowerCase();

  if (
    /^(show|open)\s+(my\s+)?(experience|applications?|apps)\b/.test(lower) ||
    /^my\s+(experience|applications?|apps)\b/.test(lower)
  ) {
    return { kind: "show_experience" };
  }

  const open = lower.match(/^(?:open|launch|start)\s+(.+)$/);
  if (open?.[1]) {
    const q = clean(open[1].replace(/\s+in\s+(os\s+)?experience$/i, ""));
    if (q && !/^my\s+/.test(q)) return { kind: "open", query: q };
  }

  const add = lower.match(
    /^(?:add|experience|include)\s+(.+?)(?:\s+to\s+(?:my\s+)?experience)?$/,
  );
  if (add?.[1]) {
    return { kind: "start_experience", query: clean(add[1]) };
  }

  const findCat = lower.match(
    /^(?:find|search|show|discover)\s+(?:me\s+)?(?:a\s+|an\s+)?(.+?)\s+(?:apps?|applications?)$/,
  );
  if (findCat?.[1]) {
    const key = findCat[1].trim();
    const mapped = CATEGORY_ALIASES[key];
    if (mapped) return { kind: "category", category: mapped };
    return { kind: "search", query: key };
  }

  const find = lower.match(/^(?:find|search|show|discover)\s+(?:me\s+)?(.+)$/);
  if (find?.[1]) {
    const rest = clean(find[1]);
    const mapped = CATEGORY_ALIASES[rest];
    if (mapped) return { kind: "category", category: mapped };
    return { kind: "search", query: rest };
  }

  for (const [alias, category] of Object.entries(CATEGORY_ALIASES)) {
    if (lower === alias || lower === `${alias} apps` || lower === `${alias} applications`) {
      return { kind: "category", category };
    }
  }

  // Bare application name → search / open candidate
  if (text.length >= 2 && text.length <= 64 && !/\s{2,}/.test(text)) {
    return { kind: "search", query: text };
  }

  return { kind: "unresolved", text };
}

export function utteranceDoesNotGrantAuthorization(): true {
  return true;
}
