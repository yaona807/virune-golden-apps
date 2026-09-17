import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { jsx } from '@builder.io/qwik';
import { createDOM } from '@builder.io/qwik/testing';
import { createOptimizer } from '@builder.io/qwik/optimizer';

const source = String.raw`
import { Fragment, component$, useSignal, useTask$ } from '@builder.io/qwik';

export const rootSignals = new Map();
export const rowSignals = new Map();
export const cleanupEvents = [];

export function validateSnapshot(snapshot) {
  const seen = new Set();
  for (const entry of snapshot) {
    if (seen.has(entry.id)) throw new Error('duplicate repetition identity: ' + entry.id);
    seen.add(entry.id);
  }
  return snapshot;
}

export function repetitionHost(snapshot, renderGroup) {
  validateSnapshot(snapshot);
  return snapshot.map((entry) => (
    <Fragment key={entry.id}>
      {renderGroup(entry.value, entry.index, entry.id)}
    </Fragment>
  ));
}

export const StatefulRow = component$((props) => {
  const mark = useSignal('cold');
  rowSignals.set(props.registryId, mark);
  useTask$(({ cleanup }) => {
    const identity = props.registryId;
    cleanup(() => cleanupEvents.push(identity));
  });
  return (
    <button data-id={props.registryId} onClick$={() => { mark.value = 'hot'; }}>
      {props.label}:{props.index}:{mark.value}
    </button>
  );
});

function renderNestedGroup(value, index, id) {
  return (
    <section data-outer-id={id}>
      <span data-outer-label={id}>{value.label}:{index}</span>
      {repetitionHost(value.children, (childValue, childIndex, childId) => (
        <StatefulRow
          registryId={id + '/' + childId}
          label={childValue.label}
          index={childIndex}
        />
      ))}
    </section>
  );
}

export const PrototypeRoot = component$((props) => {
  const snapshot = useSignal(props.initialSnapshot);
  rootSignals.set(props.rootKey, snapshot);
  return (
    <main data-root={props.rootKey}>
      {repetitionHost(snapshot.value, renderNestedGroup)}
    </main>
  );
});
`;

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

function assertInnerOrder(screen, outerId, expected) {
  const outer = byAttr(screen, 'data-outer-id', outerId);
  assert.deepEqual(
    Array.from(outer.querySelectorAll('[data-id]'))
      .map((node) => node.getAttribute('data-id')),
    expected,
  );
}

async function flushScheduledRender(screen, userEvent) {
  await userEvent(screen, 'click');
}

const optimizer = await createOptimizer();
const output = await optimizer.transformModules({
  srcDir: '/src',
  input: [{ path: 'optimizer-runtime.tsx', code: source }],
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
const errors = output.diagnostics.filter((diagnostic) => diagnostic.category === 'error' || diagnostic.category === 'sourceError');
assert.deepEqual(errors, []);
assert.equal(output.modules.length, 1);

const generatedPath = resolve(`.qwik-optimizer-runtime-${process.pid}.mjs`);
await writeFile(generatedPath, output.modules[0].code, 'utf8');

try {
  const runtime = await import(`${pathToFileURL(generatedPath).href}?run=${Date.now()}`);
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
    initialSnapshot: nestedInitial,
  }));
  await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
  console.log('Qwik optimizer diagnostic: nested initial flush complete');

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

  const innerReordered = makeNestedSnapshot([
    ['s:5:alpha', 'alpha-v2', [
      ['s:9:alpha-two', 'alpha-two-v2'],
      ['s:9:alpha-one', 'alpha-one-v2'],
    ]],
    ['s:4:beta', 'beta-v2', [
      ['s:8:beta-one', 'beta-one-v2'],
    ]],
  ]);
  runtime.rootSignals.get('nested').value = innerReordered;
  await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
  console.log('Qwik optimizer diagnostic: inner reorder complete');
  assertInnerOrder(nestedDOM.screen, 's:5:alpha', [
    's:5:alpha/s:9:alpha-two',
    's:5:alpha/s:9:alpha-one',
  ]);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha/s:9:alpha-one'), alphaOneState);
  assert.strictEqual(runtime.rowSignals.get('s:5:alpha/s:9:alpha-two'), alphaTwoState);
  assert.strictEqual(runtime.rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
  assert.equal(byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one').textContent, 'alpha-one-v2:1:hot');
  assert.equal(runtime.cleanupEvents.length, 0);

  const nestedWithoutAlpha = makeNestedSnapshot([
    ['s:4:beta', 'beta-v2', [
      ['s:8:beta-one', 'beta-one-v2'],
    ]],
  ]);
  console.log('Qwik optimizer diagnostic: nested delete start');
  runtime.rootSignals.get('nested').value = nestedWithoutAlpha;
  await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
  console.log('Qwik optimizer diagnostic: nested delete complete');
  assert.equal(runtime.cleanupEvents.length, 2);
  assert.deepEqual(
    new Set(runtime.cleanupEvents),
    new Set(['s:5:alpha/s:9:alpha-one', 's:5:alpha/s:9:alpha-two']),
  );
  assert.strictEqual(runtime.rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);

  nestedRender.cleanup();
  await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
  assert.equal(runtime.cleanupEvents.length, 3);
  assert.equal(new Set(runtime.cleanupEvents).size, 3);
  console.log('Qwik optimizer nested reorder/delete: PASS');
} finally {
  await unlink(generatedPath).catch(() => {});
}
