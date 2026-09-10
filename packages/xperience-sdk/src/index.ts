import { isAllowedMessageOrigin, validateHandshake, type XperienceReady } from "@digiconomy/xperience-contract";
export interface XperienceClientOptions { applicationId: string; origin: string; parentWindow?: Window; }
/** Minimal channel only: no credentials, storage, identity proof, or authorization is transported. */
export function createXperienceClient(options: XperienceClientOptions) {
  const parent = options.parentWindow ?? window.parent;
  return { handshake(event: MessageEvent): XperienceReady | null { if (!isAllowedMessageOrigin(event.origin, options.origin)) return null; const result = validateHandshake(event.data, options); if (!result.ok) return null; const ready: XperienceReady = { type:"DIGICONOMY_XPERIENCE_READY", protocol:"1", applicationId:options.applicationId, nonce:result.value.nonce }; parent.postMessage(ready, event.origin); return ready; } };
}
