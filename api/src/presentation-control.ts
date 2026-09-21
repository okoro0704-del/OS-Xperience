import {
  normalizeChapterAction,
  normalizePresentationStatus,
  normalizeVisibility,
  presentationStatusTransitionAllowed,
  type ChapterAction,
  type ExperienceVisibility,
  type Presentation,
  type PresentationAudienceState,
  type PresentationChapter,
  type PresentationStatus,
  type PresentationView,
} from "@digiconomy/xperience-contract";
import { DomainError, type Actor } from "./domain.js";
import type { ExperienceReleaseCatalog } from "./release-catalog.js";

export interface PresentationAudit {
  action: string;
  presentationId: string;
  actorId: string;
  actorType: string;
  at: string;
  detail?: string;
  chapterId?: string;
  experienceId?: string;
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * In-memory presentation control — orchestrates X3 release transitions for live unveilings.
 */
export class PresentationControlService {
  private presentations = new Map<string, Presentation>();
  private chapters = new Map<string, PresentationChapter[]>();
  private audits: PresentationAudit[] = [];
  private activePresentationId: string | null = null;

  constructor(private readonly releaseCatalog: ExperienceReleaseCatalog) {}

  list(): PresentationView[] {
    return [...this.presentations.values()]
      .map((item) => this.toView(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): PresentationView {
    const presentation = this.presentations.get(id);
    if (!presentation) throw new DomainError("Presentation not found.", "not_found");
    return this.toView(presentation);
  }

  create(
    actor: Actor,
    input: {
      title: string;
      chapters: Array<{
        title: string;
        experienceId: string;
        action?: ChapterAction;
        visibility?: ExperienceVisibility;
        notes?: string;
      }>;
      skipRevealConfirm?: boolean;
    },
  ): PresentationView {
    const now = new Date().toISOString();
    const id = newId("pres");
    const presentation: Presentation = {
      id,
      title: input.title.trim() || "Untitled presentation",
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
      skipRevealConfirm: Boolean(input.skipRevealConfirm),
    };
    const chapters: PresentationChapter[] = (input.chapters ?? []).map((chapter, index) => ({
      id: newId("ch"),
      presentationId: id,
      order: index + 1,
      title: chapter.title.trim() || `Chapter ${index + 1}`,
      experienceId: chapter.experienceId,
      action: normalizeChapterAction(chapter.action ?? "REVEAL"),
      visibility: normalizeVisibility(chapter.visibility ?? "FEATURED"),
      notes: chapter.notes,
      createdAt: now,
    }));
    if (chapters[0]) presentation.currentChapterId = chapters[0].id;
    this.presentations.set(id, presentation);
    this.chapters.set(id, chapters);
    this.audit(actor, "presentation.created", id, { detail: presentation.title });
    return this.toView(presentation);
  }

  seedDefaultIfEmpty(): PresentationView | null {
    if (this.presentations.size > 0) return null;
    return this.create(
      { id: "system", role: "ADMIN" },
      {
        title: "OS Xperience Live Unveiling",
        chapters: [
          {
            title: "mybrandOS",
            experienceId: "bootstrap.mybrandos.public",
            action: "NO_CHANGE",
            visibility: "FEATURED",
          },
          {
            title: "LifeOS",
            experienceId: "lifeos",
            action: "REVEAL",
            visibility: "FEATURED",
          },
        ],
      },
    );
  }

  markReady(actor: Actor, id: string): PresentationView {
    return this.setStatus(actor, id, "READY");
  }

  start(actor: Actor, id: string): PresentationView {
    const presentation = this.require(id);
    if (presentation.status === "DRAFT") {
      this.assertTransition(presentation.status, "READY");
      presentation.status = "READY";
    }
    this.assertTransition(presentation.status, "LIVE");
    const now = new Date().toISOString();
    presentation.status = "LIVE";
    presentation.startedAt = now;
    presentation.updatedAt = now;
    if (!presentation.currentChapterId) {
      const first = this.orderedChapters(id)[0];
      presentation.currentChapterId = first?.id;
    }
    this.activePresentationId = id;
    this.audit(actor, "presentation.started", id, {
      chapterId: presentation.currentChapterId,
      detail: `startedAt=${now}`,
    });
    return this.toView(presentation);
  }

  pause(actor: Actor, id: string): PresentationView {
    const view = this.setStatus(actor, id, "PAUSED");
    this.audit(actor, "presentation.paused", id);
    return view;
  }

  resume(actor: Actor, id: string): PresentationView {
    const view = this.setStatus(actor, id, "LIVE");
    this.activePresentationId = id;
    this.audit(actor, "presentation.resumed", id);
    return view;
  }

  end(actor: Actor, id: string): PresentationView {
    const presentation = this.require(id);
    this.assertTransition(presentation.status, "ENDED");
    presentation.status = "ENDED";
    presentation.endedAt = new Date().toISOString();
    presentation.updatedAt = presentation.endedAt;
    if (this.activePresentationId === id) this.activePresentationId = null;
    this.audit(actor, "presentation.ended", id);
    return this.toView(presentation);
  }

  /**
   * Move pointer only — does not execute chapter action.
   * Spec: do not combine navigation and destructive actions ambiguously.
   */
  goToChapter(actor: Actor, id: string, chapterId: string): PresentationView {
    const presentation = this.require(id);
    const chapter = this.orderedChapters(id).find((item) => item.id === chapterId);
    if (!chapter) throw new DomainError("Chapter not found.", "not_found");
    presentation.currentChapterId = chapter.id;
    presentation.updatedAt = new Date().toISOString();
    this.audit(actor, "presentation.chapter.selected", id, {
      chapterId: chapter.id,
      experienceId: chapter.experienceId,
    });
    return this.toView(presentation);
  }

  nextChapter(actor: Actor, id: string): PresentationView {
    const view = this.get(id);
    if (!view.nextChapter) throw new DomainError("Already at the last chapter.");
    return this.goToChapter(actor, id, view.nextChapter.id);
  }

  previousChapter(actor: Actor, id: string): PresentationView {
    const view = this.get(id);
    if (!view.previousChapter) throw new DomainError("Already at the first chapter.");
    return this.goToChapter(actor, id, view.previousChapter.id);
  }

  /**
   * One-tap reveal for current chapter — delegates to X3 release catalog.
   */
  revealCurrent(
    actor: Actor,
    id: string,
    options?: { confirm?: boolean },
  ): { presentation: PresentationView; experienceId: string; releaseState: string } {
    const presentation = this.require(id);
    if (presentation.status !== "LIVE" && presentation.status !== "PAUSED") {
      throw new DomainError("Start the presentation before revealing chapters.");
    }
    const chapter = this.orderedChapters(id).find((item) => item.id === presentation.currentChapterId);
    if (!chapter) throw new DomainError("No current chapter to reveal.", "not_found");

    const needsConfirm = !presentation.skipRevealConfirm;
    if (needsConfirm && options?.confirm !== true) {
      throw new DomainError("Reveal requires confirmation (confirm: true).");
    }

    const action = chapter.action;
    if (action === "NO_CHANGE") {
      this.audit(actor, "presentation.chapter.reveal.skipped", id, {
        chapterId: chapter.id,
        experienceId: chapter.experienceId,
        detail: "NO_CHANGE",
      });
      return {
        presentation: this.toView(presentation),
        experienceId: chapter.experienceId,
        releaseState: this.releaseCatalog.get(chapter.experienceId)?.releaseState ?? "UNKNOWN",
      };
    }

    if (action === "REVEAL" || action === "FEATURE") {
      const visibility = action === "FEATURE" ? "FEATURED" : chapter.visibility;
      this.releaseCatalog.goLive(actor, chapter.experienceId, visibility);
    } else if (action === "HIDE") {
      const entry = this.releaseCatalog.get(chapter.experienceId);
      if (entry) {
        this.releaseCatalog.changeRelease(actor, chapter.experienceId, {
          releaseState: entry.releaseState === "LIVE" ? "LOCKED" : entry.releaseState,
          visibility: "HIDDEN",
          confirmLive: false,
        });
      }
    } else if (action === "PAUSE") {
      this.releaseCatalog.pause(actor, chapter.experienceId);
    } else if (action === "RESUME") {
      this.releaseCatalog.goLive(actor, chapter.experienceId, chapter.visibility);
    }

    presentation.updatedAt = new Date().toISOString();
    this.audit(actor, "presentation.chapter.revealed", id, {
      chapterId: chapter.id,
      experienceId: chapter.experienceId,
      detail: action,
    });
    return {
      presentation: this.toView(presentation),
      experienceId: chapter.experienceId,
      releaseState: this.releaseCatalog.get(chapter.experienceId)?.releaseState ?? "LIVE",
    };
  }

  audienceState(): PresentationAudienceState | null {
    const id = this.activePresentationId;
    if (!id) return null;
    const presentation = this.presentations.get(id);
    if (!presentation || (presentation.status !== "LIVE" && presentation.status !== "PAUSED")) {
      return null;
    }
    const chapter = this.orderedChapters(id).find((item) => item.id === presentation.currentChapterId);
    return {
      presentationId: presentation.id,
      title: presentation.title,
      status: presentation.status,
      currentChapterId: presentation.currentChapterId,
      currentChapterTitle: chapter?.title,
      currentExperienceId: chapter?.experienceId,
      updatedAt: presentation.updatedAt,
    };
  }

  listAudits(limit = 100): PresentationAudit[] {
    return this.audits.slice(0, limit);
  }

  private setStatus(actor: Actor, id: string, to: PresentationStatus): PresentationView {
    const presentation = this.require(id);
    this.assertTransition(presentation.status, to);
    presentation.status = to;
    presentation.updatedAt = new Date().toISOString();
    this.audit(actor, "presentation.status.changed", id, { detail: to });
    return this.toView(presentation);
  }

  private assertTransition(from: PresentationStatus, to: PresentationStatus): void {
    if (!presentationStatusTransitionAllowed(from, to)) {
      throw new DomainError(`Invalid presentation transition ${from} → ${to}.`, "conflict");
    }
  }

  private require(id: string): Presentation {
    const presentation = this.presentations.get(id);
    if (!presentation) throw new DomainError("Presentation not found.", "not_found");
    return presentation;
  }

  private orderedChapters(id: string): PresentationChapter[] {
    return [...(this.chapters.get(id) ?? [])].sort((a, b) => a.order - b.order);
  }

  private toView(presentation: Presentation): PresentationView {
    const chapters = this.orderedChapters(presentation.id);
    const index = chapters.findIndex((item) => item.id === presentation.currentChapterId);
    const currentChapter = index >= 0 ? chapters[index]! : chapters[0] ?? null;
    return {
      ...presentation,
      status: normalizePresentationStatus(presentation.status),
      chapters,
      currentChapter,
      nextChapter: index >= 0 && index < chapters.length - 1 ? chapters[index + 1]! : null,
      previousChapter: index > 0 ? chapters[index - 1]! : null,
    };
  }

  private audit(
    actor: Actor,
    action: string,
    presentationId: string,
    extra?: { chapterId?: string; experienceId?: string; detail?: string },
  ): void {
    this.audits.unshift({
      action,
      presentationId,
      actorId: actor.id,
      actorType: actor.role,
      at: new Date().toISOString(),
      chapterId: extra?.chapterId,
      experienceId: extra?.experienceId,
      detail: extra?.detail,
    });
  }
}

let sharedPresentation: PresentationControlService | null = null;

export function getPresentationControl(releaseCatalog: ExperienceReleaseCatalog): PresentationControlService {
  if (!sharedPresentation) {
    sharedPresentation = new PresentationControlService(releaseCatalog);
    sharedPresentation.seedDefaultIfEmpty();
  }
  return sharedPresentation;
}

export function resetPresentationControlForTests(
  releaseCatalog: ExperienceReleaseCatalog,
): PresentationControlService {
  sharedPresentation = new PresentationControlService(releaseCatalog);
  sharedPresentation.seedDefaultIfEmpty();
  return sharedPresentation;
}
