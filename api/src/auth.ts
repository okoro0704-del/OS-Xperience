import type { Actor, Role } from "./domain.js";

export interface AuthenticationProvider {
  authenticate(headers: Record<string, string | string[] | undefined>): Promise<Actor | null>;
}

/** Trust ID will implement this provider; it must return an asserted subject, never biometric material. */
export class TrustIdAuthenticationProvider implements AuthenticationProvider {
  async authenticate(): Promise<Actor | null> {
    return null;
  }
}

/**
 * Local-only adapter. Rejected unless NODE_ENV=development and XPERIENCE_DEV_AUTH=true.
 * Header: X-Xperience-Dev-Actor: ROLE:id
 * Optional: X-Xperience-Dev-Email, X-Xperience-Dev-Name
 */
export class DevelopmentAuthenticationProvider implements AuthenticationProvider {
  constructor(
    private readonly enabled =
      process.env.NODE_ENV === "development" && process.env.XPERIENCE_DEV_AUTH === "true",
  ) {}

  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Actor | null> {
    if (!this.enabled) return null;
    if (process.env.NODE_ENV === "production") return null;
    const raw = headers["x-xperience-dev-actor"];
    if (typeof raw !== "string") return null;
    const [role, id] = raw.split(":");
    if (!(role === "DEVELOPER" || role === "ADMIN" || role === "USER") || !id) return null;
    const actor: Actor = { id, role: role as Role };
    const emailHeader = headers["x-xperience-dev-email"];
    if (typeof emailHeader === "string" && emailHeader) actor.email = emailHeader;
    const nameHeader = headers["x-xperience-dev-name"];
    if (typeof nameHeader === "string" && nameHeader) actor.displayName = nameHeader;
    return actor;
  }
}

/**
 * Production consumer participant assertion — USER role only.
 * Enabled with XPERIENCE_PARTICIPANT_AUTH=true until Trust ID is connected.
 * Never elevates to DEVELOPER/ADMIN. Not an identity proof.
 */
export class ParticipantAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly enabled = process.env.XPERIENCE_PARTICIPANT_AUTH === "true") {}

  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Actor | null> {
    if (!this.enabled) return null;
    const raw = headers["x-xperience-dev-actor"];
    if (typeof raw !== "string") return null;
    const [role, id] = raw.split(":");
    if (role !== "USER" || !id || id.length > 128) return null;
    if (!/^[a-zA-Z0-9._:@-]+$/.test(id)) return null;
    const actor: Actor = { id, role: "USER" };
    const emailHeader = headers["x-xperience-dev-email"];
    if (typeof emailHeader === "string" && emailHeader) actor.email = emailHeader;
    const nameHeader = headers["x-xperience-dev-name"];
    if (typeof nameHeader === "string" && nameHeader) actor.displayName = nameHeader;
    return actor;
  }
}

export class CompositeAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly providers: AuthenticationProvider[]) {}

  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Actor | null> {
    for (const provider of this.providers) {
      const actor = await provider.authenticate(headers);
      if (actor) return actor;
    }
    return null;
  }
}

export function productionAuthProvider(): AuthenticationProvider {
  return new CompositeAuthenticationProvider([
    new TrustIdAuthenticationProvider(),
    new ParticipantAuthenticationProvider(),
  ]);
}
