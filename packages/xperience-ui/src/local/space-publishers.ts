import type { TrustedSpacePublisher } from "@digiconomy/xperience-contract";
import { MYBRANDOS_PUBLIC_ID } from "./bootstrap.js";

/**
 * Space Launch File trust roots pinned into this build: public verification keys only, each
 * bound to the provider identities its publisher may describe.
 */
export const BUNDLED_SPACE_PUBLISHERS: readonly TrustedSpacePublisher[] = [
  {
    publisherId: "mybrandos",
    name: "mybrandOS",
    keys: [{ keyId: "mybrandos-space-2026-10", publicKeySpkiBase64: "MCowBQYDK2VwAyEApFLP6i8/NigGRiDEICnMQA3ftWOqxE4S3jBwY0nZG6o=" }],
    providers: [MYBRANDOS_PUBLIC_ID],
  },
];

let testPublishers: readonly TrustedSpacePublisher[] | null = null;

export function trustedSpacePublishers(): readonly TrustedSpacePublisher[] {
  return testPublishers ?? BUNDLED_SPACE_PUBLISHERS;
}

/** Test-only: replace the pinned publishers; null restores the bundled set. */
export function setTrustedSpacePublishersForTests(publishers: readonly TrustedSpacePublisher[] | null): void {
  testPublishers = publishers;
}
