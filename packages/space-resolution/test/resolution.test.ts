import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvocation, ResolverRegistry, type ResolvedSpaceDefinition } from '../src/index.ts';

function definition(spaceId = 'space:atlas', version = 1): ResolvedSpaceDefinition {
  return {
    identity: { spaceId, canonicalName: 'Atlas Home', aliases: ['atlas-home', 'Atlas'] },
    version,
    contractVersion: '1',
    capabilities: ['read'],
    bootstrap: { entry: '/atlas' },
  };
}

test('normalization preserves raw input, trims, collapses whitespace and lowercases names', () => {
  const raw = ' \tATLAS\n  Home  ';
  assert.deepEqual(normalizeInvocation(raw), { raw, normalized: 'atlas home', kind: 'NAME' });
});

test('empty and whitespace-only invocations are invalid', async () => {
  const registry = new ResolverRegistry();
  registry.register({ providerId: 'unused', supports() { assert.fail('must not query providers'); }, resolve: () => [] });
  for (const raw of ['', ' \n\t ']) {
    assert.equal(normalizeInvocation(raw), undefined);
    assert.deepEqual(await registry.resolve(raw), { state: 'INVALID_INVOCATION' });
  }
});

test('normalization classifies current ID, alias and name syntax', () => {
  for (const [raw, kind] of [[' SPACE:Atlas-1:Home ', 'ID'], ['atlas-home', 'ALIAS'], ['Atlas', 'NAME'], ['space:', 'NAME'], ['space:atlas/home', 'NAME']] as const) {
    assert.equal(normalizeInvocation(raw)?.kind, kind);
  }
});

test('registration replaces a provider by ID and list returns an independent array', () => {
  const registry = new ResolverRegistry();
  const first = { providerId: 'first', resolve: () => [] };
  const second = { providerId: 'second', resolve: () => [] };
  const replacement = { providerId: 'first', resolve: () => [] };
  registry.register(first);
  registry.register(second);
  registry.register(replacement);
  assert.deepEqual(registry.list(), [second, replacement]);
  registry.list().pop();
  assert.deepEqual(registry.list(), [second, replacement]);
  registry.unregister('second');
  registry.unregister('missing');
  assert.deepEqual(registry.list(), [replacement]);
});

test('an empty registry and providers without results return NOT_FOUND', async () => {
  const registry = new ResolverRegistry();
  assert.deepEqual(await registry.resolve('Atlas'), { state: 'NOT_FOUND' });
  registry.register({ providerId: 'empty', resolve: () => [] });
  assert.deepEqual(await registry.resolve('Atlas'), { state: 'NOT_FOUND' });
});

test('unsupported providers are skipped and supports receives the normalized invocation', async () => {
  const registry = new ResolverRegistry();
  registry.register({ providerId: 'unsupported', supports(x) {
    assert.deepEqual(x, { raw: ' ATLAS ', normalized: 'atlas', kind: 'NAME' });
    return false;
  }, resolve() { assert.fail('unsupported provider called'); } });
  const expected = definition();
  registry.register({ providerId: 'supported', supports: x => x.normalized === 'atlas', resolve: () => [expected] });
  assert.deepEqual(await registry.resolve(' ATLAS '), { state: 'RESOLVED', definition: expected });
});

for (const [field, raw] of [['ID', ' SPACE:ATLAS '], ['name', ' ATLAS\t HOME '], ['alias', ' ATLAS-HOME '], ['alias without hyphen', ' ATLAS ']]) {
  test(`resolves a case-insensitive ${field} match and preserves the complete definition`, async () => {
    const registry = new ResolverRegistry();
    const expected = definition('SPACE:ATLAS');
    expected.identity.aliases = ['ATLAS-HOME', 'ATLAS'];
    registry.register({ providerId: 'catalog', resolve: () => [expected] });
    const result = await registry.resolve(raw);
    assert.deepEqual(result, { state: 'RESOLVED', definition: expected });
    assert.equal(result.definition, expected);
  });
}

test('nonmatching and partial provider results are ignored', async () => {
  const registry = new ResolverRegistry();
  registry.register({ providerId: 'catalog', resolve: () => [definition()] });
  for (const raw of ['unknown', 'atl', 'space:at', 'atlas-h']) {
    assert.deepEqual(await registry.resolve(raw), { state: 'NOT_FOUND' });
  }
});

test('providers run in descending priority with stable ties and default priority zero', async () => {
  const registry = new ResolverRegistry();
  const calls: string[] = [];
  for (const [providerId, priority] of [['default', undefined], ['low', -1], ['high-first', 10], ['zero', 0], ['high-second', 10]] as const) {
    registry.register({ providerId, priority, async resolve(x) {
      assert.equal(x.normalized, 'atlas');
      calls.push(providerId);
      return [];
    } });
  }
  assert.deepEqual(await registry.resolve('Atlas'), { state: 'NOT_FOUND' });
  assert.deepEqual(calls, ['high-first', 'high-second', 'default', 'zero', 'low']);
  assert.deepEqual(registry.list().map(p => p.providerId), ['default', 'low', 'high-first', 'zero', 'high-second']);
});

test('duplicate space IDs resolve to the first matching definition in provider order', async () => {
  const registry = new ResolverRegistry();
  const preferred = definition('space:atlas', 1);
  registry.register({ providerId: 'lower', resolve: () => [definition('space:atlas', 2)] });
  registry.register({ providerId: 'higher', priority: 10, resolve: async () => [preferred, preferred] });
  assert.deepEqual(await registry.resolve('Atlas'), { state: 'RESOLVED', definition: preferred });
});

test('distinct matching space IDs are ambiguous, with duplicate candidates removed', async () => {
  const registry = new ResolverRegistry();
  const first = definition();
  const second = definition('space:other');
  registry.register({ providerId: 'first', priority: 1, resolve: () => [first, first] });
  registry.register({ providerId: 'second', resolve: async () => [second, second] });
  assert.deepEqual(await registry.resolve('Atlas'), { state: 'AMBIGUOUS', candidates: [first.identity, second.identity] });
});

for (const asynchronous of [false, true]) {
  test(`${asynchronous ? 'async rejection' : 'synchronous failure'} returns unavailable even after a match`, async () => {
    const registry = new ResolverRegistry();
    registry.register({ providerId: 'match', priority: 2, resolve: () => [definition()] });
    registry.register({ providerId: 'failure', priority: 1, resolve: asynchronous
      ? async () => { throw new Error('offline'); }
      : () => { throw new Error('offline'); } });
    registry.register({ providerId: 'later', resolve() { assert.fail('must stop after failure'); } });
    assert.deepEqual(await registry.resolve('Atlas'), { state: 'RESOLUTION_UNAVAILABLE' });
  });
}
