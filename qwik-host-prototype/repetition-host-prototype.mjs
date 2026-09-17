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

export const StatefulRow = component$((props) => {
  const mark = useSignal('cold');
  rowSignals.set(props.id, mark);
  return (
    <button data-id={props.id} onClick$={() => { mark.value = 'hot'; }}>
      {props.id}:{mark.value}
    </button>
  );
});

export const ProbeRoot = component$(() => {
  const order = useSignal(['alpha', 'beta']);
  orderSignals.set('root', order);
  return (
    <main>
      {order.value.map((id) => (
        <Fragment key={id}>
          <StatefulRow id={id} />
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
  input: [{ path: 'keyed-fragment-probe.tsx', code: source }],
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

const generatedPath = resolve(`.qwik-keyed-fragment-probe-${process.pid}.mjs`);
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
  assert.equal(byAttr(dom.screen, 'data-id', 'alpha').textContent, 'alpha:hot');

  runtime.orderSignals.get('root').value = ['beta', 'alpha'];
  await flush(dom.screen, dom.userEvent);
  assertOrder(dom.screen, 'data-id', ['beta', 'alpha']);
  assertOrder(dom.screen, 'data-meta-id', ['beta', 'alpha']);

  const alphaAfter = runtime.rowSignals.get('alpha');
  const betaAfter = runtime.rowSignals.get('beta');
  console.log(`Qwik keyed Fragment state: alphaSame=${alphaAfter === alphaState} betaSame=${betaAfter === betaState} alpha=${alphaAfter?.value}`);
  if (alphaAfter !== alphaState || betaAfter !== betaState || alphaAfter?.value !== 'hot') {
    throw new Error('Qwik keyed Fragment reorder did not retain component-local state');
  }

  renderResult.cleanup();
  await flush(dom.screen, dom.userEvent);
  console.log('Qwik minimal keyed Fragment reorder: PASS');
} finally {
  await unlink(generatedPath).catch(() => {});
}
