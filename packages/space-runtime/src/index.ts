/** Product-local Space Contract V1. UI adapters own activation and media lifecycles. */
export const PRESENTATION_STATES = ['GLASS','REVEAL_HANDLE','SUMMONED_UI','INTERACTION','SWITCHING','REVOLVING'] as const;
export type PresentationState = typeof PRESENTATION_STATES[number];
export type ExperienceDefinition = {
  id: string;
  title: string;
  type: string;
  lifecyclePolicy: 'retained';
  offlinePolicy: 'cached' | 'unavailable';
};
export type SpaceDefinition = {
  id: string;
  owner: string;
  defaultExperienceId: string;
  experiences: readonly ExperienceDefinition[];
};
export type SpaceSnapshot = {
  spaceId: string;
  lastActiveExperienceId: string;
  handlePinned: boolean;
  persistentUI: boolean;
};
export type SpaceRuntime = {
  currentSpaceId: string;
  currentExperienceId: string;
  presentationState: PresentationState;
  handlePinned: boolean;
  persistentUI: boolean;
  saved: Record<string, SpaceSnapshot>;
  pending: null | { id: number; spaceId: string; experienceId: string };
  sequence: number;
  error: string | null;
};
export type SpaceEvent =
  | { type: 'DOUBLE_TAP_CANVAS' | 'TAP_HANDLE' | 'DOUBLE_TAP_HANDLE' | 'HANDLE_TIMEOUT' | 'KEEP_UI' | 'HIDE_UI' | 'OPEN_INTERACTIONS' | 'CLOSE_INTERACTIONS' }
  | { type: 'SELECT_EXPERIENCE'; experienceId: string }
  | { type: 'REVOLVE'; spaceId: string }
  | { type: 'ACTIVATED' | 'ACTIVATION_FAILED'; transitionId: number };
function validExperience(space: SpaceDefinition, id: string) {
  return id !== 'SPACE' && space.experiences.some(e => e.id === id);
}
function definition(registry: readonly SpaceDefinition[], id: string) {
  return registry.find(space => space.id === id);
}
export function snapshotSpace(state: SpaceRuntime): SpaceSnapshot {
  return { spaceId: state.currentSpaceId, lastActiveExperienceId: state.currentExperienceId,
    handlePinned: state.handlePinned, persistentUI: state.persistentUI };
}
export function createSpaceRuntime(space: SpaceDefinition, restored?: SpaceSnapshot): SpaceRuntime {
  if (!validExperience(space, space.defaultExperienceId)) throw new Error('Invalid default experience');
  const safe = restored?.spaceId === space.id ? restored : undefined;
  return { currentSpaceId: space.id,
    currentExperienceId: safe && validExperience(space, safe.lastActiveExperienceId) ? safe.lastActiveExperienceId : space.defaultExperienceId,
    presentationState: safe?.persistentUI ? 'SUMMONED_UI' : 'GLASS',
    handlePinned: safe?.handlePinned === true, persistentUI: safe?.persistentUI === true,
    saved: {}, pending: null, sequence: 0, error: null };
}
export function reduceSpace(state: SpaceRuntime, event: SpaceEvent, registry: readonly SpaceDefinition[]): SpaceRuntime {
  const phase = state.presentationState;
  if (event.type === 'ACTIVATED' || event.type === 'ACTIVATION_FAILED') {
    if ((phase !== 'SWITCHING' && phase !== 'REVOLVING') || !state.pending || state.pending.id !== event.transitionId) return state;
    if (event.type === 'ACTIVATION_FAILED') return { ...state, pending: null, presentationState: 'SUMMONED_UI', error: 'Activation failed' };
    const target = definition(registry, state.pending.spaceId);
    if (!target || !validExperience(target, state.pending.experienceId)) return { ...state, pending: null, presentationState: 'SUMMONED_UI', error: 'Target unavailable' };
    const prefs = phase === 'REVOLVING' ? state.saved[target.id] : snapshotSpace(state);
    const persistentUI = prefs?.persistentUI === true;
    return { ...state, currentSpaceId: target.id, currentExperienceId: state.pending.experienceId,
      handlePinned: prefs?.handlePinned === true, persistentUI,
      presentationState: 'GLASS', pending: null, error: null };
  }
  switch (event.type) {
    case 'DOUBLE_TAP_CANVAS':
      return phase === 'GLASS' ? { ...state, presentationState: 'REVEAL_HANDLE' } : state;
    case 'TAP_HANDLE':
      return phase === 'REVEAL_HANDLE' || (phase === 'GLASS' && state.handlePinned) ? { ...state, presentationState: 'SUMMONED_UI' } : state;
    case 'DOUBLE_TAP_HANDLE':
      return phase === 'REVEAL_HANDLE' || (phase === 'GLASS' && state.handlePinned)
        ? { ...state, presentationState: 'REVEAL_HANDLE', handlePinned: !state.handlePinned } : state;
    case 'HANDLE_TIMEOUT':
      return phase === 'REVEAL_HANDLE' && !state.handlePinned ? { ...state, presentationState: 'GLASS' } : state;
    case 'KEEP_UI':
      return phase === 'SUMMONED_UI' ? { ...state, persistentUI: true } : state;
    case 'HIDE_UI':
      return phase === 'SUMMONED_UI' || (phase === 'GLASS' && state.persistentUI)
        ? { ...state, persistentUI: false, presentationState: 'GLASS' } : state;
    case 'OPEN_INTERACTIONS':
      return phase === 'SUMMONED_UI' || (phase === 'GLASS' && state.persistentUI)
        ? { ...state, presentationState: 'INTERACTION' } : state;
    case 'CLOSE_INTERACTIONS':
      return phase === 'INTERACTION' ? { ...state, presentationState: state.persistentUI ? 'SUMMONED_UI' : 'GLASS' } : state;
    case 'SELECT_EXPERIENCE': {
      if (phase !== 'SUMMONED_UI' && !(phase === 'GLASS' && state.persistentUI)) return state;
      const space = definition(registry, state.currentSpaceId);
      if (!space || !validExperience(space, event.experienceId) || event.experienceId === state.currentExperienceId) return state;
      return { ...state, presentationState: 'SWITCHING', sequence: state.sequence + 1, error: null,
        pending: { id: state.sequence + 1, spaceId: space.id, experienceId: event.experienceId } };
    }
    case 'REVOLVE': {
      if (phase !== 'SUMMONED_UI' && !(phase === 'GLASS' && state.persistentUI)) return state;
      const target = definition(registry, event.spaceId);
      if (!target || target.id === state.currentSpaceId || !validExperience(target, target.defaultExperienceId)) return state;
      const restored = state.saved[target.id];
      const experienceId = restored && validExperience(target, restored.lastActiveExperienceId) ? restored.lastActiveExperienceId : target.defaultExperienceId;
      return { ...state, presentationState: 'REVOLVING', sequence: state.sequence + 1, error: null,
        saved: { ...state.saved, [state.currentSpaceId]: snapshotSpace(state) },
        pending: { id: state.sequence + 1, spaceId: target.id, experienceId } };
    }
    default: return state;
  }
}
export function serializeSpace(state: SpaceRuntime): string {
  return JSON.stringify({ version: 1, ...snapshotSpace(state) });
}
export function restoreSpace(raw: string | null, space: SpaceDefinition): SpaceSnapshot | undefined {
  try {
    const data = JSON.parse(raw || 'null');
    if (!data || data.version !== 1 || data.spaceId !== space.id || !validExperience(space, data.lastActiveExperienceId)
      || typeof data.handlePinned !== 'boolean' || typeof data.persistentUI !== 'boolean') return undefined;
    return { spaceId: space.id, lastActiveExperienceId: data.lastActiveExperienceId,
      handlePinned: data.handlePinned, persistentUI: data.persistentUI };
  } catch { return undefined; }
}
export type CapabilityStatus = 'SUPPORTED' | 'UNSUPPORTED' | 'UNAVAILABLE' | 'NOT_IMPLEMENTED';

export type OfflineResult<T> =
  | { status: 'SUPPORTED'; value: T }
  | { status: 'UNSUPPORTED' | 'UNAVAILABLE' | 'NOT_IMPLEMENTED'; reason: string };
export interface OfflineSpaceAdapter {
  restoreCachedSpace(): Promise<OfflineResult<SpaceSnapshot>>;
  restoreCachedExperience(experienceId: string): Promise<OfflineResult<unknown>>;
  getAvailableMedia(): Promise<OfflineResult<readonly string[]>>;
  getConnectivityState(): 'online' | 'offline';
  getTransportCapabilities(): OfflineResult<never>;
  validateOfflineSession(): OfflineResult<never>;
}
/** Availability must be supplied by the product's real cache/connection adapter. */
export function offlineSpaceCapabilities(hasCachedMedia: boolean, connected: boolean) {
  return {
    cachedMedia: (hasCachedMedia ? 'SUPPORTED' : 'UNAVAILABLE') as CapabilityStatus,
    connectivity: connected ? 'online' : 'offline',
    offlineIdentity: 'NOT_IMPLEMENTED' as CapabilityStatus,
    callingTransport: 'NOT_IMPLEMENTED' as CapabilityStatus,
  };
}
