import { canonicalJson } from "@digiconomy/xperience-contract";
import type { SpaceSnapshot } from "@digiconomy/space-runtime";
import { SpacePackageError } from "./format.js";
import { findAuthorityField, findPrivateData } from "./policy.js";

/**
 * SP2 local state: what belongs to one installation and survives its updates.
 *
 * Kept: creator-approved offline preferences, valid application settings, local playlists,
 * references to user-created content, pending local operations, the offline execution journal, and
 * the Space Runtime presentation snapshot. Pending operations and the journal are records, never
 * disposable files: no update, migration or rollback deletes or duplicates them.
 *
 * Never kept here (each stays with its authorized owner): TrustID sessions, Digi Authority grants,
 * private keys, payment credentials, biometric templates, device-bound secrets. Every write is
 * scanned and refused if it carries any of them, or any owner/authority field.
 */
export const STATE_SCHEMA = "digiconomy.space-state/v1";

export type Scalar = string | number | boolean | null;

export type OperationStatus = "PENDING" | "HELD" | "DONE" | "CANCELLED";

export interface PendingOperation {
  opId: string;
  kind: string;
  /** Financial or otherwise consequential: never executed again because of a restore or rollback. */
  consequential: boolean;
  status: OperationStatus;
  createdAt: string;
  payload: Record<string, Scalar>;
}

export interface JournalEntry {
  seq: number;
  at: string;
  event: string;
  opId?: string;
  detail?: string;
}

export interface LocalState {
  schema: typeof STATE_SCHEMA;
  /** Identity of this state; created with the installation, kept for its whole life. */
  stateId: string;
  installationId: string;
  packageId: string;
  /** Data version written by the active release (migrations move it forward). */
  dataVersion: number;
  /** Increments on every write: optimistic concurrency and change detection. */
  revision: number;
  preferences: Record<string, Scalar>;
  settings: Record<string, Scalar>;
  playlists: Array<{ id: string; title: string; items: string[] }>;
  userContent: Array<{ id: string; title: string; ref: string; createdAt: string }>;
  pendingOperations: PendingOperation[];
  journal: JournalEntry[];
  runtime: SpaceSnapshot | null;
}

export function emptyState(ids: { stateId: string; installationId: string; packageId: string }): LocalState {
  return { schema: STATE_SCHEMA, ...ids, dataVersion: 1, revision: 0, preferences: {}, settings: {}, playlists: [], userContent: [], pendingOperations: [], journal: [], runtime: null };
}

const KEY = /^[A-Za-z0-9._-]{1,64}$/;
const isScalar = (value: unknown): value is Scalar => value === null || ["string", "number", "boolean"].includes(typeof value);
const scalarMap = (value: unknown) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.entries(value as object).every(([key, item]) => KEY.test(key) && isScalar(item));

/** Validates a state document and refuses sensitive or authority-bearing content. */
export function validateState(state: unknown): asserts state is LocalState {
  const fail = (detail: string): never => { throw new SpacePackageError("STATE_CONFLICT", `invalid state: ${detail}`); };
  const s = state as LocalState;
  if (!s || s.schema !== STATE_SCHEMA || typeof s.stateId !== "string" || typeof s.installationId !== "string" || typeof s.packageId !== "string") fail("identity");
  if (!Number.isInteger(s.dataVersion) || s.dataVersion < 1 || !Number.isInteger(s.revision) || s.revision < 0) fail("versions");
  if (!scalarMap(s.preferences) || !scalarMap(s.settings)) fail("preferences/settings");
  if (!Array.isArray(s.playlists) || !s.playlists.every((p) => p && KEY.test(p.id) && typeof p.title === "string" && Array.isArray(p.items) && p.items.every((i) => typeof i === "string"))) fail("playlists");
  if (!Array.isArray(s.userContent) || !s.userContent.every((c) => c && KEY.test(c.id) && typeof c.title === "string" && typeof c.ref === "string" && typeof c.createdAt === "string")) fail("userContent");
  if (!Array.isArray(s.pendingOperations) || !s.pendingOperations.every((op) => op && KEY.test(op.opId) && typeof op.kind === "string" && typeof op.consequential === "boolean"
    && ["PENDING", "HELD", "DONE", "CANCELLED"].includes(op.status) && scalarMap(op.payload))) fail("pendingOperations");
  if (new Set(s.pendingOperations.map((op) => op.opId)).size !== s.pendingOperations.length) fail("duplicate operation ids");
  if (!Array.isArray(s.journal) || !s.journal.every((entry, index) => entry && entry.seq === index + 1 && typeof entry.event === "string")) fail("journal must be append-only and contiguous");
  const authority = findAuthorityField(state);
  if (authority) throw new SpacePackageError("SENSITIVE_STATE_REJECTED", `authority field ${authority}`);
  const leak = findPrivateData("state.json", new TextEncoder().encode(canonicalJson(state)), "application/json");
  if (leak) throw new SpacePackageError("SENSITIVE_STATE_REJECTED", leak);
}

/* ───────────── migrations ───────────── */

export const MIGRATION_STEP_KINDS = [
  "renamePreference",
  "setPreferenceDefault",
  "removePreference",
  "renameSetting",
  "setSettingDefault",
  "renameContentItem",
  "removeContentItem",
] as const;

export type MigrationStep =
  | { op: "renamePreference" | "renameSetting"; from: string; to: string }
  | { op: "setPreferenceDefault" | "setSettingDefault"; key: string; value: Scalar }
  | { op: "removePreference"; key: string }
  | { op: "renameContentItem"; from: string; to: string }
  | { op: "removeContentItem"; item: string };

function rename(map: Record<string, Scalar>, from: string, to: string) {
  if (!(from in map) || to in map) return map;
  const { [from]: value, ...rest } = map;
  return { ...rest, [to]: value as Scalar };
}

/**
 * Pure and deterministic: the same state and steps always give the same result, so a migration
 * interrupted at any point can simply be run again. It never touches user content, pending
 * operations or the journal; playlist entries for removed creator content are dropped, user content is not.
 */
export function migrateState(state: LocalState, migration: { fromDataVersion: number; toDataVersion: number; steps: readonly MigrationStep[] }): LocalState {
  if (state.dataVersion !== migration.fromDataVersion) {
    throw new SpacePackageError("MIGRATION_FAILED", `state data version ${state.dataVersion}, migration expects ${migration.fromDataVersion}`);
  }
  let next: LocalState = structuredClone(state);
  for (const step of migration.steps) {
    switch (step.op) {
      case "renamePreference": next.preferences = rename(next.preferences, step.from, step.to); break;
      case "renameSetting": next.settings = rename(next.settings, step.from, step.to); break;
      case "setPreferenceDefault":
        if (!KEY.test(step.key) || !isScalar(step.value)) throw new SpacePackageError("MIGRATION_FAILED", "setPreferenceDefault");
        if (!(step.key in next.preferences)) next.preferences = { ...next.preferences, [step.key]: step.value };
        break;
      case "setSettingDefault":
        if (!KEY.test(step.key) || !isScalar(step.value)) throw new SpacePackageError("MIGRATION_FAILED", "setSettingDefault");
        if (!(step.key in next.settings)) next.settings = { ...next.settings, [step.key]: step.value };
        break;
      case "removePreference": { const { [step.key]: _removed, ...rest } = next.preferences; next.preferences = rest; break; }
      case "renameContentItem":
        next.playlists = next.playlists.map((playlist) => ({ ...playlist, items: playlist.items.map((item) => (item === step.from ? step.to : item)) }));
        break;
      case "removeContentItem":
        next.playlists = next.playlists.map((playlist) => ({ ...playlist, items: playlist.items.filter((item) => item !== step.item) }));
        break;
      default:
        throw new SpacePackageError("MIGRATION_FAILED", `unknown step ${(step as { op: string }).op}`);
    }
  }
  next = { ...next, dataVersion: migration.toDataVersion };
  validateState(next);
  return next;
}

/* ───────────── operations and journal ───────────── */

export function appendJournal(state: LocalState, at: Date, event: string, extra: { opId?: string; detail?: string } = {}): LocalState {
  return { ...state, journal: [...state.journal, { seq: state.journal.length + 1, at: at.toISOString(), event, ...extra }] };
}

/** Records a pending local operation exactly once: re-adding the same opId is a no-op, never a duplicate. */
export function addPendingOperation(state: LocalState, op: Omit<PendingOperation, "status">, at: Date): LocalState {
  if (state.pendingOperations.some((item) => item.opId === op.opId)) return state;
  return appendJournal({ ...state, pendingOperations: [...state.pendingOperations, { ...op, status: "PENDING" }] }, at, "OPERATION_RECORDED", { opId: op.opId });
}

export function completeOperation(state: LocalState, opId: string, at: Date): LocalState {
  const op = state.pendingOperations.find((item) => item.opId === opId);
  if (!op || op.status === "DONE") return state;
  return appendJournal({ ...state, pendingOperations: state.pendingOperations.map((item) => (item.opId === opId ? { ...item, status: "DONE" as const } : item)) }, at, "OPERATION_COMPLETED", { opId });
}

/**
 * After a restore, rollback or recovery, consequential operations still PENDING are HELD: they need
 * an explicit new confirmation and are never replayed automatically. DONE stays DONE.
 */
export function holdConsequentialOperations(state: LocalState, at: Date, reason: string): LocalState {
  const held = state.pendingOperations.filter((op) => op.consequential && op.status === "PENDING");
  if (!held.length) return state;
  let next: LocalState = { ...state, pendingOperations: state.pendingOperations.map((op) => (op.consequential && op.status === "PENDING" ? { ...op, status: "HELD" as const } : op)) };
  for (const op of held) next = appendJournal(next, at, "OPERATION_HELD", { opId: op.opId, detail: reason });
  return next;
}
