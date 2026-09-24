import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpaceRuntime, reduceSpace, restoreSpace, serializeSpace, offlineSpaceCapabilities, type SpaceDefinition } from '../src/index.ts';
const spaces: SpaceDefinition[] = ['space.a', 'space.b'].map(id => ({ id, owner: id, defaultExperienceId: 'APP', experiences: ['APP','TV','RADIO'].map(id => ({ id, title:id, type:id, lifecyclePolicy:'retained', offlinePolicy:'cached' })) }));
const reduce = (s: ReturnType<typeof createSpaceRuntime>, e: Parameters<typeof reduceSpace>[1]) => reduceSpace(s, e, spaces);
test('canonical runtime preserves Glass, Switch, Revolve, persistence and offline honesty', () => {
  let s = createSpaceRuntime(spaces[0]);
  assert.equal(s.presentationState, 'GLASS');
  s = reduce(s, { type:'DOUBLE_TAP_CANVAS' }); assert.equal(s.presentationState, 'REVEAL_HANDLE');
  s = reduce(s, { type:'DOUBLE_TAP_HANDLE' }); assert.equal(s.handlePinned, true);
  s = reduce(s, { type:'TAP_HANDLE' }); assert.equal(s.presentationState, 'SUMMONED_UI');
  s = reduce(s, { type:'SELECT_EXPERIENCE', experienceId:'TV' }); s = reduce(s, { type:'ACTIVATED', transitionId:s.pending!.id });
  assert.equal(s.currentExperienceId, 'TV');
  // Activation returns to Glass; Revolve is legal only from summoned/persistent UI.
  s = reduce(s, { type:'DOUBLE_TAP_CANVAS' }); s = reduce(s, { type:'TAP_HANDLE' });
  s = reduce(s, { type:'REVOLVE', spaceId:'space.b' }); s = reduce(s, { type:'ACTIVATED', transitionId:s.pending!.id });
  s = reduce(s, { type:'DOUBLE_TAP_CANVAS' }); s = reduce(s, { type:'TAP_HANDLE' });
  s = reduce(s, { type:'REVOLVE', spaceId:'space.a' }); assert.ok(s.pending); s = reduce(s, { type:'ACTIVATED', transitionId:s.pending.id });
  assert.equal(s.currentExperienceId, 'TV'); assert.equal(s.handlePinned, true);
  assert.equal(createSpaceRuntime(spaces[0], restoreSpace(serializeSpace(s), spaces[0])).currentExperienceId, 'TV');
  assert.equal(offlineSpaceCapabilities(false, false).offlineIdentity, 'NOT_IMPLEMENTED');
});
