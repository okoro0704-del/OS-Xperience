import type { AppClass } from "./identity.js";

export interface DigitalLifeContext {
  brandSlug: string | null;
  assetIds: string[];
  projectIds: string[];
  /** Never a Trust ID, token, or session. Null until identity.public is both granted and bound. */
  userRef: null;
  /** Presence only. Not ownership of files, Assets, or commerce. */
  digitalLifeRef: "present" | null;
  brandRef: string | null;
  activeApplication: {
    origin: string;
    name: string;
    class: AppClass;
  } | null;
}

/** Least privilege. Never include devices, balances, Command Center, or owner sessions. */
export function emptyDigitalLifeContext(): DigitalLifeContext {
  return {
    brandSlug: null,
    assetIds: [],
    projectIds: [],
    userRef: null,
    digitalLifeRef: null,
    brandRef: null,
    activeApplication: null,
  };
}

export function leastPrivilegeDigitalLifeContext(app: {
  origin: string;
  name: string;
  class: AppClass;
}): DigitalLifeContext {
  return {
    ...emptyDigitalLifeContext(),
    digitalLifeRef: "present",
    activeApplication: { origin: app.origin, name: app.name, class: app.class },
  };
}
