import type { Actor, Role } from "./domain.js";

export interface AuthenticationProvider { authenticate(headers: Record<string, string | string[] | undefined>): Promise<Actor | null>; }
/** Trust ID will implement this provider; it must return an asserted subject, never biometric material. */
export class TrustIdAuthenticationProvider implements AuthenticationProvider { async authenticate(): Promise<Actor | null> { return null; } }
/** Local-only adapter. It is rejected unless NODE_ENV=development and explicitly enabled. */
export class DevelopmentAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly enabled = process.env.NODE_ENV === "development" && process.env.XPERIENCE_DEV_AUTH === "true") {}
  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Actor | null> { if (!this.enabled) return null; const raw=headers["x-xperience-dev-actor"]; if(typeof raw!=="string") return null; const [role,id]=raw.split(":"); return (role==="DEVELOPER"||role==="ADMIN")&&id ? {id,role:role as Role}:null; }
}
export function productionAuthProvider(): AuthenticationProvider { return new TrustIdAuthenticationProvider(); }
