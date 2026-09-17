import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jsx } from '@builder.io/qwik';
import { createOptimizer } from '@builder.io/qwik/optimizer';
import { createDOM } from '@builder.io/qwik/testing';

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({
    id,
    index,
    value: { label },
  }));
}

function makeNestedSnapshot(entries) {
  return entries.map(([id, label, children], index) => ({
    id,
    index,
    value: {
      label,
      children: children.map(([childId, childLabel], childIndex) => ({
        id: childId,
        index: childIndex,
        value: { label: childLabel },
      })),
    },
  }));
}

function byAttr(screen, attribute, value) {
  const node = Array.from(screen.querySelectorAll(`[${attribute}]`))
    .find((candidate) => candidate.getAttribute(attribute) === value);
  assert.ok(node, `missing ${attribute}=${value}`);
  return node;
}

function maybeByAttr(screen, attribute, value) {
  return Array.from(screen.querySelectorAll(`[${attribute}]`))
    .find((candidate) => candidate.getAttribute(attribute) === value);
}

function assertOrder(screen, attribute, expected) {
  assert.deepEqual(
    Array.from(screen.querySelectorAll(`[${attribute}]`))
      .map((node) => node.getAttribute(attribute)),
    expected,
  );
}

function assertRow(screen, id, expectedText) {
  assert.equal(byAttr(screen, 'data-id', id).textContent, expectedText);
}

function assertCleanups(runtime, expected) {
  assert.equal(runtime.cleanupEvents.length, expected.length);
  assert.equal(new Set(runtime.cleanupEvents).size, runtime.cleanupEvents.length);
  assert.deepEqual(
    [...runtime.cleanupEvents].sort(),
    [...expected].sort(),
  );
}

async function flushScheduledRender(screen, userEvent) {
  // Public Qwik testing userEvent flushes the test platform after dispatch.
  // Dispatching on the root host itself is intentionally inert.
  await userEvent(screen, 'click');
}

async function replaceSnapshot(runtime, rootKey, nextSnapshot, screen, userEvent) {
  const signal = runtime.rootSignals.get(rootKey);
  assert.ok(signal, `missing root signal ${rootKey}`);
  signal.value = nextSnapshot;
  await flushScheduledRender(screen, userEvent);
}

async function cleanupRender(result, screen, userEvent) {
  result.cleanup();
  await flushScheduledRender(screen, userEvent);
}

const source = await readFile(resolve('qwik-host-runtime.tsx'), 'utf8');
const optimizer = await createOptimizer();
const output = await optimizer.transformModules({
  srcDir: '/src',
  input: [{ path: 'qwik-host-runtime.tsx', code: source }],
  entryStrategy: { type: 'inline' },
  minify: 'none',
  sourceMaps: false,
  transpileTs: true,
  transpileJsx: true,
  preserveFilenames: true,
  explicitExtensions: true,
  mode: 'dev',
  isServer: false,
});
const errors = output.diagnostics.filter(
  (diagnostic) => diagnostic.category === 'error' || diagnostic.category === 'sourceError',
);
assert.deepEqual(errors, []);
assert.equal(output.modules.length, 1);

const generatedPath = resolve('.qwik-host-runtime.generated.mjs');
await writeFile(generatedPath, output.modules[0].code, 'utf8');

try {
  const runtime = await import(pathToFileURL(generatedPath).href);

  // Duplicate identities fail before the render callback can produce keyed output.
  let bodyCalls = 0;
  assert.throws(
    () => runtime.repetitionHost(() => [
      { id: 's:5:alpha', index: 0, value: { label: 'alpha' } },
      { id: 's:5:alpha', index: 1, value: { label: 'alpha-copy' } },
    ], () => {
      bodyCalls += 1;
      return null;
    }),
    /duplicate repetition identity: s:5:alpha/,
  );
  assert.equal(bodyCalls, 0);

  const flatDOM = await createDOM();
  const flatInitial = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]);
  const flatRender = await flatDOM.render(jsx(runtime.PrototypeRoot, {
    rootKey: 'flat',
    mode: 'flat',
    initialSnapshot: flatInitial,
  }));
  await flushScheduledRender(flatDOM.screen, flatDOM.userEvent);

  assertOrder(flatDOM.screen, 'data-id', ['s:5:alpha', 's:4:beta']);
  assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:alpha', 's:4:beta']);
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha:0:cold');
  assertRow(flatDOM.screen, 's:4:beta', 'beta:1:cold');
  assertCleanups(runtime, []);

  const alphaState = runtime.rowSignals.get('s:5:alpha');
  const betaState = runtime.rowSignals.get('s:4:beta');
  assert.ok(alphaState);
  assert.ok(betaState);
  await flatDOM.userEvent(byAttr(flatDOM.screen, 'data-id', 's:5:alpha'), 'click');
  assert.equal(alphaState.value, 'hot');
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha:0:hot');

  // Append keeps surviving logical identity while every transported value is fresh.
  const appended = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]);
  assert.notStrictEqual(appended[0].value, flatInitial[0].value);
  assert.notStrictEqual(appended[1].value, flatInitial[1].value);
  await replaceSnapshot(runtime, 'flat', appended, flatDOM.screen, flatDOM.userEvent);
  assertOrder(flatDOM.screen, 'data-id', ['s:5:alpha', 's:4:beta', 's:5:gamma']);
  assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:alpha', 's:4:beta', 's:5:gamma']);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha'), alphaState);
  assert.strictEqual(runtime.rowSignals.get('s:4:beta'), betaState);
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha:0:hot');
  assertCleanups(runtime, []);

  const gammaState = runtime.rowSignals.get('s:5:gamma');
  assert.ok(gammaState);

  // Prepend updates current index/value without moving local state away from id.
  const prepended = makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha-v2'],
    ['s:4:beta', 'beta-v2'],
    ['s:5:gamma', 'gamma-v2'],
  ]);
  assert.notStrictEqual(prepended[1].value, appended[0].value);
  await replaceSnapshot(runtime, 'flat', prepended, flatDOM.screen, flatDOM.userEvent);
  assertOrder(flatDOM.screen, 'data-id', ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
  assertOrder(flatDOM.screen, 'data-meta-id', ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha'), alphaState);
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha-v2:1:hot');
  assertRow(flatDOM.screen, 's:4:beta', 'beta-v2:2:cold');
  assertCleanups(runtime, []);

  const zeroState = runtime.rowSignals.get('s:4:zero');
  assert.ok(zeroState);

  // Delete disposes exactly the removed identity.
  const withoutBeta = makeSnapshot([
    ['s:4:zero', 'zero-v2'],
    ['s:5:alpha', 'alpha-v3'],
    ['s:5:gamma', 'gamma-v3'],
  ]);
  await replaceSnapshot(runtime, 'flat', withoutBeta, flatDOM.screen, flatDOM.userEvent);
  assert.equal(maybeByAttr(flatDOM.screen, 'data-id', 's:4:beta'), undefined);
  assert.equal(maybeByAttr(flatDOM.screen, 'data-meta-id', 's:4:beta'), undefined);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha'), alphaState);
  assert.strictEqual(runtime.rowSignals.get('s:5:gamma'), gammaState);
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha-v3:1:hot');
  assertCleanups(runtime, ['s:4:beta']);

  // Reorder moves both siblings as one keyed group and preserves local state.
  const reordered = makeSnapshot([
    ['s:5:gamma', 'gamma-v4'],
    ['s:5:alpha', 'alpha-v4'],
    ['s:4:zero', 'zero-v3'],
  ]);
  await replaceSnapshot(runtime, 'flat', reordered, flatDOM.screen, flatDOM.userEvent);
  assertOrder(flatDOM.screen, 'data-id', ['s:5:gamma', 's:5:alpha', 's:4:zero']);
  assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:gamma', 's:5:alpha', 's:4:zero']);
  assert.strictEqual(runtime.rowSignals.get('s:5:gamma'), gammaState);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha'), alphaState);
  assert.strictEqual(runtime.rowSignals.get('s:4:zero'), zeroState);
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha-v4:1:hot');
  assertCleanups(runtime, ['s:4:beta']);

  // Same-id replacement exposes a fresh current value without resetting state.
  const valueUpdated = makeSnapshot([
    ['s:5:gamma', 'gamma-v5'],
    ['s:5:alpha', 'alpha-v5'],
    ['s:4:zero', 'zero-v4'],
  ]);
  assert.notStrictEqual(valueUpdated[1].value, reordered[1].value);
  await replaceSnapshot(runtime, 'flat', valueUpdated, flatDOM.screen, flatDOM.userEvent);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha'), alphaState);
  assertRow(flatDOM.screen, 's:5:alpha', 'alpha-v5:1:hot');
  assertRow(flatDOM.screen, 's:5:gamma', 'gamma-v5:0:cold');
  assertCleanups(runtime, ['s:4:beta']);

  // Identity replacement is remove + add; local state must not transfer.
  const replacedIdentity = makeSnapshot([
    ['s:5:gamma', 'gamma-v6'],
    ['s:5:delta', 'delta'],
    ['s:4:zero', 'zero-v5'],
  ]);
  await replaceSnapshot(runtime, 'flat', replacedIdentity, flatDOM.screen, flatDOM.userEvent);
  assert.equal(maybeByAttr(flatDOM.screen, 'data-id', 's:5:alpha'), undefined);
  assert.equal(maybeByAttr(flatDOM.screen, 'data-meta-id', 's:5:alpha'), undefined);
  assertOrder(flatDOM.screen, 'data-id', ['s:5:gamma', 's:5:delta', 's:4:zero']);
  assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:gamma', 's:5:delta', 's:4:zero']);
  const deltaState = runtime.rowSignals.get('s:5:delta');
  assert.ok(deltaState);
  assert.notStrictEqual(deltaState, alphaState);
  assert.equal(deltaState.value, 'cold');
  assertRow(flatDOM.screen, 's:5:delta', 'delta:1:cold');
  assertCleanups(runtime, ['s:4:beta', 's:5:alpha']);

  await cleanupRender(flatRender, flatDOM.screen, flatDOM.userEvent);
  assertCleanups(runtime, [
    's:4:beta',
    's:5:alpha',
    's:5:gamma',
    's:5:delta',
    's:4:zero',
  ]);

  runtime.cleanupEvents.length = 0;
  runtime.rootSignals.clear();
  runtime.rowSignals.clear();

  // Nested repetition composes the same opaque-id contract at both levels.
  const nestedDOM = await createDOM();
  const nestedInitial = makeNestedSnapshot([
    ['s:5:alpha', 'alpha', [
      ['s:9:alpha-one', 'alpha-one'],
      ['s:9:alpha-two', 'alpha-two'],
    ]],
    ['s:4:beta', 'beta', [
      ['s:8:beta-one', 'beta-one'],
    ]],
  ]);
  const nestedRender = await nestedDOM.render(jsx(runtime.PrototypeRoot, {
    rootKey: 'nested',
    mode: 'nested',
    initialSnapshot: nestedInitial,
  }));
  await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);

  assertOrder(nestedDOM.screen, 'data-outer-id', ['s:5:alpha', 's:4:beta']);
  assert.equal(byAttr(nestedDOM.screen, 'data-outer-label', 's:5:alpha').textContent, 'alpha:0');
  assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-one', 'alpha-one:0:cold');
  assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-two', 'alpha-two:1:cold');

  const alphaOneState = runtime.rowSignals.get('s:5:alpha/s:9:alpha-one');
  const alphaTwoState = runtime.rowSignals.get('s:5:alpha/s:9:alpha-two');
  const betaOneState = runtime.rowSignals.get('s:4:beta/s:8:beta-one');
  assert.ok(alphaOneState);
  assert.ok(alphaTwoState);
  assert.ok(betaOneState);
  await nestedDOM.userEvent(
    byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one'),
    'click',
  );
  assert.equal(alphaOneState.value, 'hot');
  assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-one', 'alpha-one:0:hot');

  const nestedReordered = makeNestedSnapshot([
    ['s:4:beta', 'beta-v2', [
      ['s:8:beta-one', 'beta-one-v2'],
    ]],
    ['s:5:alpha', 'alpha-v2', [
      ['s:9:alpha-two', 'alpha-two-v2'],
      ['s:9:alpha-one', 'alpha-one-v2'],
    ]],
  ]);
  assert.notStrictEqual(nestedReordered[1].value, nestedInitial[0].value);
  assert.notStrictEqual(
    nestedReordered[1].value.children[1].value,
    nestedInitial[0].value.children[0].value,
  );
  await replaceSnapshot(runtime, 'nested', nestedReordered, nestedDOM.screen, nestedDOM.userEvent);

  assertOrder(nestedDOM.screen, 'data-outer-id', ['s:4:beta', 's:5:alpha']);
  assert.equal(byAttr(nestedDOM.screen, 'data-outer-label', 's:5:alpha').textContent, 'alpha-v2:1');
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha/s:9:alpha-one'), alphaOneState);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha/s:9:alpha-two'), alphaTwoState);
  assert.strictEqual(runtime.rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
  assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-two', 'alpha-two-v2:0:cold');
  assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-one', 'alpha-one-v2:1:hot');
  assertRow(nestedDOM.screen, 's:4:beta/s:8:beta-one', 'beta-one-v2:0:cold');
  assertCleanups(runtime, []);

  // Removing one outer identity disposes both current nested children exactly once.
  const nestedWithoutAlpha = makeNestedSnapshot([
    ['s:4:beta', 'beta-v3', [
      ['s:8:beta-one', 'beta-one-v3'],
    ]],
  ]);
  await replaceSnapshot(runtime, 'nested', nestedWithoutAlpha, nestedDOM.screen, nestedDOM.userEvent);
  assert.equal(maybeByAttr(nestedDOM.screen, 'data-outer-id', 's:5:alpha'), undefined);
  assert.strictEqual(runtime.rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
  assertRow(nestedDOM.screen, 's:4:beta/s:8:beta-one', 'beta-one-v3:0:cold');
  assertCleanups(runtime, [
    's:5:alpha/s:9:alpha-one',
    's:5:alpha/s:9:alpha-two',
  ]);

  await cleanupRender(nestedRender, nestedDOM.screen, nestedDOM.userEvent);
  assertCleanups(runtime, [
    's:5:alpha/s:9:alpha-one',
    's:5:alpha/s:9:alpha-two',
    's:4:beta/s:8:beta-one',
  ]);

  console.log('Qwik repetition Host prototype: PASS');
  console.log('Qwik observation: Optimizer-visible keyed groups preserve opaque-id state when transported value is passed as one current prop; exact render/task scheduling remains non-portable.');
} finally {
  await unlink(generatedPath).catch(() => {});
}
