import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { jsx } from '@builder.io/qwik';
import { createDOM } from '@builder.io/qwik/testing';
import { createOptimizer } from '@builder.io/qwik/optimizer';

const source = String.raw`
import { Fragment, component$, useSignal } from '@builder.io/qwik';

export const orderSignals = new Map();
export const rowSignals = new Map();

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
  return snapshot.map((entry) => renderGroup(entry.value, entry.index, entry.id));
}

export const StatefulRow = component$((props) => {
  const mark = useSignal('cold');
  rowSignals.set(props.id, mark);
  return (
    <button data-id={props.id} onClick$={() => { mark.value = 'hot'; }}>
      {props.value.label}:{props.index}:{mark.value}
    </button>
  );
});

export const ProbeRoot = component$(() => {
  const snapshot = useSignal([
    { id: 'alpha', index: 0, value: { label: 'alpha' } },
    { id: 'beta', index: 1, value: { label: 'beta' } },
  ]);
  orderSignals.set('root', snapshot);
  return (
    <main>
      {repetitionHost(snapshot.value, (value, index, id) => (
        <Fragment key={id}>
          <StatefulRow id={id} value={value} index={index} />
          <span data-meta-id={id}>{id}</span>
        </Fragment>
      ))}
    </main>
  );
});
`;

function byAttr(screen, attribute, value) {
  const node = Array.from(screen.querySelectorAll(`[${attribute}]`))
    .find((candidate) => candidate.getAttribute(attribute) === value);
  assert.ok(node, `missing ${attribute}=${value}`);
  return node;
}

function assertOrder(screen, attribute, expected) {
  assert.deepEqual(
    Array.from(screen.querySelectorAll(`[${attribute}]`))
      .map((node) => node.getAttribute(attribute)),
    expected,
  );
}

async function flush(screen, userEvent) {
  await userEvent(screen, 'click');
}

const optimizer = await createOptimizer();
const output = await optimizer.transformModules({
  srcDir: '/src',
  input: [{ path: 'host-callback-group-probe.tsx', code: source }],
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

const generatedPath = resolve(`.qwik-host-callback-group-probe-${process.pid}.mjs`);
await writeFile(generatedPath, output.modules[0].code, 'utf8');

try {
  const runtime = await import(`${pathToFileURL(generatedPath).href}?run=${Date.now()}`);
  const dom = await createDOM();
  const renderResult = await dom.render(jsx(runtime.ProbeRoot, {}));
  await flush(dom.screen, dom.userEvent);

  const alphaState = runtime.rowSignals.get('alpha');
  const betaState = runtime.rowSignals.get('beta');
  assert.ok(alphaState);
  assert.ok(betaState);
  await dom.userEvent(byAttr(dom.screen, 'data-id', 'alpha'), 'click');
  assert.equal(alphaState.value, 'hot');
  assert.equal(byAttr(dom.screen, 'data-id', 'alpha').textContent, 'alpha:0:hot');

  runtime.orderSignals.get('root').value = [
    { id: 'beta', index: 0, value: { label: 'beta-v2' } },
    { id: 'alpha', index: 1, value: { label: 'alpha-v2' } },
  ];
  await flush(dom.screen, dom.userEvent);
  assertOrder(dom.screen, 'data-id', ['beta', 'alpha']);
  assertOrder(dom.screen, 'data-meta-id', ['beta', 'alpha']);

  const alphaAfter = runtime.rowSignals.get('alpha');
  const betaAfter = runtime.rowSignals.get('beta');
  console.log(`Qwik Host transported-value state: alphaSame=${alphaAfter === alphaState} betaSame=${betaAfter === betaState} alpha=${alphaAfter?.value}`);
  if (alphaAfter !== alphaState || betaAfter !== betaState || alphaAfter?.value !== 'hot') {
    throw new Error('Qwik Host transported-value reorder did not retain component-local state');
  }
  assert.equal(byAttr(dom.screen, 'data-id', 'alpha').textContent, 'alpha-v2:1:hot');

  renderResult.cleanup();
  await flush(dom.screen, dom.userEvent);
  console.log('Qwik Host transported-value reorder: PASS');
} finally {
  await unlink(generatedPath).catch(() => {});
}
