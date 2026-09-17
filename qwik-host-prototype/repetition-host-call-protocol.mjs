import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jsx } from '@builder.io/qwik';
import { createOptimizer } from '@builder.io/qwik/optimizer';
import { createDOM } from '@builder.io/qwik/testing';

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({ id, index, value: { label } }));
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

function assertOrder(screen, attribute, expected) {
  assert.deepEqual(
    Array.from(screen.querySelectorAll(`[${attribute}]`)).map((node) => node.getAttribute(attribute)),
    expected,
  );
}

async function flush(screen, userEvent) {
  await userEvent(screen, 'click');
}

async function replaceSnapshot(runtime, rootKey, snapshot, screen, userEvent) {
  const signal = runtime.rootSignals.get(rootKey);
  assert.ok(signal, `missing root signal ${rootKey}`);
  signal.value = snapshot;
  await flush(screen, userEvent);
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

const generatedPath = resolve('.qwik-host-call-protocol.generated.mjs');
await writeFile(generatedPath, output.modules[0].code, 'utf8');

try {
  const runtime = await import(pathToFileURL(generatedPath).href);

  let bodyCalls = 0;
  assert.throws(() => runtime.repetitionHostProtocol(
    () => [
      { id: 's:5:alpha', index: 0, value: { label: 'alpha' } },
      { id: 's:5:alpha', index: 1, value: { label: 'alpha-copy' } },
    ],
    () => {
      bodyCalls += 1;
      return null;
    },
  ), /duplicate repetition identity: s:5:alpha/);
  assert.equal(bodyCalls, 0);

  const flatDOM = await createDOM();
  const flatRender = await flatDOM.render(jsx(runtime.ProtocolRoot, {
    rootKey: 'protocol-flat',
    mode: 'flat',
    initialSnapshot: makeSnapshot([
      ['s:5:alpha', 'alpha'],
      ['s:4:beta', 'beta'],
    ]),
  }));
  await flush(flatDOM.screen, flatDOM.userEvent);
  assertOrder(flatDOM.screen, 'data-id', ['s:5:alpha', 's:4:beta']);
  assert.equal(byAttr(flatDOM.screen, 'data-id', 's:5:alpha').textContent, 'alpha:0:cold');

  await flatDOM.userEvent(byAttr(flatDOM.screen, 'data-id', 's:5:alpha'), 'click');
  assert.equal(byAttr(flatDOM.screen, 'data-id', 's:5:alpha').textContent, 'alpha:0:hot');

  await replaceSnapshot(runtime, 'protocol-flat', makeSnapshot([
    ['s:4:beta', 'beta-v2'],
    ['s:5:alpha', 'alpha-v2'],
  ]), flatDOM.screen, flatDOM.userEvent);
  assertOrder(flatDOM.screen, 'data-id', ['s:4:beta', 's:5:alpha']);
  assert.equal(byAttr(flatDOM.screen, 'data-id', 's:5:alpha').textContent, 'alpha-v2:1:hot');
  flatRender.cleanup();
  await flush(flatDOM.screen, flatDOM.userEvent);

  const cleanupBaseline = runtime.cleanupEvents.length;
  const nestedDOM = await createDOM();
  const nestedRender = await nestedDOM.render(jsx(runtime.ProtocolRoot, {
    rootKey: 'protocol-nested',
    mode: 'nested',
    initialSnapshot: makeNestedSnapshot([
      ['s:5:alpha', 'alpha', [
        ['s:9:alpha-one', 'alpha-one'],
        ['s:9:alpha-two', 'alpha-two'],
      ]],
      ['s:4:beta', 'beta', [
        ['s:8:beta-one', 'beta-one'],
      ]],
    ]),
  }));
  await flush(nestedDOM.screen, nestedDOM.userEvent);
  await nestedDOM.userEvent(byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one'), 'click');

  await replaceSnapshot(runtime, 'protocol-nested', makeNestedSnapshot([
    ['s:4:beta', 'beta-v2', [
      ['s:8:beta-one', 'beta-one-v2'],
    ]],
    ['s:5:alpha', 'alpha-v2', [
      ['s:9:alpha-two', 'alpha-two-v2'],
      ['s:9:alpha-one', 'alpha-one-v2'],
    ]],
  ]), nestedDOM.screen, nestedDOM.userEvent);
  assert.equal(byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one').textContent, 'alpha-one-v2:1:hot');

  await replaceSnapshot(runtime, 'protocol-nested', makeNestedSnapshot([
    ['s:4:beta', 'beta-v3', [
      ['s:8:beta-one', 'beta-one-v3'],
    ]],
  ]), nestedDOM.screen, nestedDOM.userEvent);
  const protocolCleanups = runtime.cleanupEvents.slice(cleanupBaseline);
  assert.equal(protocolCleanups.filter((id) => id === 's:5:alpha/s:9:alpha-one').length, 1);
  assert.equal(protocolCleanups.filter((id) => id === 's:5:alpha/s:9:alpha-two').length, 1);

  nestedRender.cleanup();
  await flush(nestedDOM.screen, nestedDOM.userEvent);
} finally {
  await unlink(generatedPath).catch(() => {});
}

console.log('Qwik repetition host call protocol: PASS');
