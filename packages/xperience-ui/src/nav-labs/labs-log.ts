import type { ExperimentId, LabEvent } from "./types.js";
import { appendLabEvent as persistLabEvent, getLabEvents as loadLabEvents, clearLabEvents as wipeLabEvents } from "./labs-store.js";

const MAX_EVENTS = 200;
const memory: LabEvent[] = [];

function trim(): void {
  while (memory.length > MAX_EVENTS) memory.shift();
}

/**
 * Append a diagnostics event. Never log content, passwords, or camera frames.
 */
export function appendLabEvent(input: {
  type: string;
  experiment: ExperimentId | null;
  detail?: string;
}): void {
  const detail =
    typeof input.detail === "string" ? input.detail.slice(0, 160) : undefined;
  const event: LabEvent = {
    type: input.type,
    experiment: input.experiment,
    detail,
    at: Date.now(),
  };
  memory.push(event);
  trim();
  persistLabEvent(event);
}

export function getLabEvents(): LabEvent[] {
  if (memory.length) return memory.slice();
  const stored = loadLabEvents();
  memory.splice(0, memory.length, ...stored.slice(-MAX_EVENTS));
  return memory.slice();
}

export function clearLabEvents(): void {
  memory.splice(0, memory.length);
  wipeLabEvents();
}
