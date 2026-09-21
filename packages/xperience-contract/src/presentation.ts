/**
 * Phase X4 — Presentation Control Mode (orchestrates X3 release machinery).
 */

export const PRESENTATION_STATUSES = ["DRAFT", "READY", "LIVE", "PAUSED", "ENDED"] as const;
export type PresentationStatus = (typeof PRESENTATION_STATUSES)[number];

export const CHAPTER_ACTIONS = [
  "REVEAL",
  "FEATURE",
  "HIDE",
  "PAUSE",
  "RESUME",
  "NO_CHANGE",
] as const;
export type ChapterAction = (typeof CHAPTER_ACTIONS)[number];

export function normalizePresentationStatus(value: unknown): PresentationStatus {
  if (typeof value === "string" && (PRESENTATION_STATUSES as readonly string[]).includes(value)) {
    return value as PresentationStatus;
  }
  return "DRAFT";
}

export function normalizeChapterAction(value: unknown): ChapterAction {
  if (typeof value === "string" && (CHAPTER_ACTIONS as readonly string[]).includes(value)) {
    return value as ChapterAction;
  }
  return "NO_CHANGE";
}

const STATUS_GRAPH: Record<PresentationStatus, PresentationStatus[]> = {
  DRAFT: ["READY", "ENDED"],
  READY: ["LIVE", "DRAFT", "ENDED"],
  LIVE: ["PAUSED", "ENDED"],
  PAUSED: ["LIVE", "ENDED"],
  ENDED: [],
};

export function presentationStatusTransitionAllowed(
  from: PresentationStatus,
  to: PresentationStatus,
): boolean {
  if (from === to) return true;
  return STATUS_GRAPH[from].includes(to);
}

export interface PresentationChapter {
  id: string;
  presentationId: string;
  order: number;
  title: string;
  experienceId: string;
  action: ChapterAction;
  /** Target visibility when action is REVEAL / FEATURE / HIDE. */
  visibility: "HIDDEN" | "LISTED" | "FEATURED";
  notes?: string;
  createdAt: string;
}

export interface Presentation {
  id: string;
  title: string;
  status: PresentationStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  currentChapterId?: string;
  /** When true, Reveal skips confirm dialog (rehearsal only). */
  skipRevealConfirm?: boolean;
}

export interface PresentationView extends Presentation {
  chapters: PresentationChapter[];
  currentChapter?: PresentationChapter | null;
  nextChapter?: PresentationChapter | null;
  previousChapter?: PresentationChapter | null;
}

/** Lightweight audience-facing pointer — never includes private keys. */
export interface PresentationAudienceState {
  presentationId: string;
  title: string;
  status: PresentationStatus;
  currentChapterId?: string;
  currentChapterTitle?: string;
  currentExperienceId?: string;
  updatedAt: string;
}
