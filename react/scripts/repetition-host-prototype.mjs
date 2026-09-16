import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  act,
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

function validateSnapshot(snapshot) {
  const seen = new Set();
  for (const entry of snapshot) {
    if (seen.has(entry.id)) throw new Error(`duplicate repetition identity: ${entry.id}`);
    seen.add(entry.id);
  }
  return snapshot;
}

function RepetitionGroup({ entry, renderGroup }) {
  const currentEntry = useRef(entry);
  currentEntry.current = entry;
  const value = useCallback(() => currentEntry.current.value, []);
  const index = useCallback(() => currentEntry.current.index, []);
  return renderGroup(value, index, entry.id);
}

function RepetitionHost({ snapshot, renderGroup }) {
  return validateSnapshot(snapshot).map((entry) => createElement(RepetitionGroup, {
    key: entry.id,
    entry,
    renderGroup,
  }));
}

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({
    id,
    index,
    // Deliberately allocate a fresh object for every snapshot. Reconciliation must
    // depend only on the opaque logical id, never transported value identity.
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

const lifecycle = [];
const renderCalls = new Map();

function StatefulRow({ value, index, id, lifecyclePrefix = '' }) {
  const [mark, setMark] = useState('cold');
  useEffect(() => {
    lifecycle.push(`${lifecyclePrefix}mount:${id}`);
    return () => lifecycle.push(`${lifecyclePrefix}dispose:${id}`);
  }, [id, lifecyclePrefix]);
  return createElement('button', {
    type: 'button',
    'data-id': `${lifecyclePrefix}${id}`,
    onClick: () => setMark('hot'),
  }, `${value().label}:${index()}:${mark}`);
}

function renderStatefulGroup(value, index, id) {
  renderCalls.set(id, (renderCalls.get(id) ?? 0) + 1);
  return createElement(StatefulRow, { value, index, id });
}

function BasicScenario({ snapshot }) {
  return createElement(RepetitionHost, { snapshot, renderGroup: renderStatefulGroup });
}

function NestedOuter({ value, index, id }) {
  return createElement('section', { 'data-outer-id': id },
    createElement('span', { 'data-outer-label': id }, `${value().label}:${index()}`),
    createElement(RepetitionHost, {
      snapshot: value().children,
      renderGroup: (childValue, childIndex, childId) => createElement(StatefulRow, {
        value: childValue,
        index: childIndex,
        id: childId,
        lifecyclePrefix: `${id}/`,
      }),
    }),
  );
}

function NestedScenario({ snapshot }) {
  return createElement(RepetitionHost, {
    snapshot,
    renderGroup: (value, index, id) => createElement(NestedOuter, { value, index, id }),
  });
}

function rowText(root, id) {
  const row = root.querySelector(`[data-id="${id}"]`);
  assert.ok(row, `missing row ${id}`);
  return row.textContent;
}

function clickRow(dom, root, id) {
  const row = root.querySelector(`[data-id="${id}"]`);
  assert.ok(row, `missing row ${id}`);
  row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function assertOrder(root, expected) {
  assert.deepEqual(
    [...root.querySelectorAll('button[data-id]')].map((node) => node.getAttribute('data-id')),
    expected,
  );
}

// Duplicate identity must fail before the host creates any keyed group elements.
assert.throws(() => RepetitionHost({
  snapshot: makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:5:alpha', 'alpha-copy'],
  ]),
  renderGroup: renderStatefulGroup,
}), /duplicate repetition identity: s:5:alpha/);
assert.equal(renderCalls.size, 0);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="nested-root"></div></body></html>');
const rootElement = dom.window.document.getElementById('root');
const nestedRootElement = dom.window.document.getElementById('nested-root');
assert.ok(rootElement);
assert.ok(nestedRootElement);

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let nestedRoot;
let rootUnmounted = false;
let nestedRootUnmounted = false;
try {
  const { createRoot } = await import('react-dom/client');
  root = createRoot(rootElement);

  let snapshot = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assertOrder(rootElement, ['s:5:alpha', 's:4:beta']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:0:cold');
  assert.equal(rowText(rootElement, 's:4:beta'), 'beta:1:cold');
  assert.deepEqual(lifecycle, ['mount:s:5:alpha', 'mount:s:4:beta']);

  await act(async () => {
    clickRow(dom, rootElement, 's:5:alpha');
  });
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:0:hot');

  // Append. Alpha/Beta are reconciled by opaque id even though value objects are new.
  snapshot = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assertOrder(rootElement, ['s:5:alpha', 's:4:beta', 's:5:gamma']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:0:hot');
  assert.equal(lifecycle.filter((event) => event === 'mount:s:5:alpha').length, 1);

  // Prepend. State follows logical id while index reflects the current snapshot.
  snapshot = makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assertOrder(rootElement, ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:1:hot');

  // Delete beta. Only beta is disposed; alpha remains mounted and hot.
  snapshot = makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
    ['s:5:gamma', 'gamma'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:4:beta').length, 1);
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 0);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:1:hot');

  // Reorder surviving groups. State remains attached to id and index updates.
  snapshot = makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assertOrder(rootElement, ['s:5:gamma', 's:4:zero', 's:5:alpha']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:2:hot');

  // Same identity + changed value updates without replacing local state.
  snapshot = makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha-v2'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha-v2:2:hot');
  assert.equal(lifecycle.filter((event) => event === 'mount:s:5:alpha').length, 1);

  // Identity transition alpha -> delta is remove + add. State must not transfer.
  snapshot = makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:delta', 'delta'],
  ]);
  await act(async () => {
    root.render(createElement(BasicScenario, { snapshot }));
  });
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 1);
  assert.equal(rowText(rootElement, 's:5:delta'), 'delta:2:cold');

  // React re-invokes the host-deferred body on normal renders while preserving
  // child component identity through the keyed group boundary. This is deliberate
  // architecture evidence: callback invocation count is not a cross-framework
  // lifecycle invariant even though observable logical-group state is preserved.
  assert.ok((renderCalls.get('s:5:alpha') ?? 0) > 1);
  assert.equal(lifecycle.filter((event) => event === 'mount:s:5:alpha').length, 1);

  nestedRoot = createRoot(nestedRootElement);
  let nestedSnapshot = makeNestedSnapshot([
    ['s:5:alpha', 'alpha', [
      ['s:9:alpha-one', 'alpha-one'],
      ['s:9:alpha-two', 'alpha-two'],
    ]],
    ['s:4:beta', 'beta', [
      ['s:8:beta-one', 'beta-one'],
    ]],
  ]);
  await act(async () => {
    nestedRoot.render(createElement(NestedScenario, { snapshot: nestedSnapshot }));
  });
  assert.equal(rowText(nestedRootElement, 's:5:alpha/s:9:alpha-one'), 'alpha-one:0:cold');
  await act(async () => {
    clickRow(dom, nestedRootElement, 's:5:alpha/s:9:alpha-one');
  });
  assert.equal(rowText(nestedRootElement, 's:5:alpha/s:9:alpha-one'), 'alpha-one:0:hot');

  nestedSnapshot = makeNestedSnapshot([
    ['s:4:beta', 'beta-v2', [
      ['s:8:beta-one', 'beta-one-v2'],
    ]],
    ['s:5:alpha', 'alpha-v2', [
      ['s:9:alpha-two', 'alpha-two-v2'],
      ['s:9:alpha-one', 'alpha-one-v2'],
    ]],
  ]);
  await act(async () => {
    nestedRoot.render(createElement(NestedScenario, { snapshot: nestedSnapshot }));
  });
  assert.equal(nestedRootElement.querySelector('[data-outer-label="s:5:alpha"]')?.textContent, 'alpha-v2:1');
  assert.equal(rowText(nestedRootElement, 's:5:alpha/s:9:alpha-one'), 'alpha-one-v2:1:hot');
  assert.equal(lifecycle.filter((event) => event === 's:5:alpha/dispose:s:9:alpha-one').length, 0);

  nestedSnapshot = makeNestedSnapshot([
    ['s:4:beta', 'beta-v3', [
      ['s:8:beta-one', 'beta-one-v3'],
    ]],
  ]);
  await act(async () => {
    nestedRoot.render(createElement(NestedScenario, { snapshot: nestedSnapshot }));
  });
  assert.equal(lifecycle.filter((event) => event === 's:5:alpha/dispose:s:9:alpha-one').length, 1);
  assert.equal(lifecycle.filter((event) => event === 's:5:alpha/dispose:s:9:alpha-two').length, 1);

  await act(async () => {
    root.unmount();
  });
  rootUnmounted = true;
  for (const id of ['s:5:gamma', 's:4:zero', 's:5:delta']) {
    assert.equal(lifecycle.filter((event) => event === `dispose:${id}`).length, 1);
  }

  await act(async () => {
    nestedRoot.unmount();
  });
  nestedRootUnmounted = true;
  assert.equal(lifecycle.filter((event) => event === 's:4:beta/dispose:s:8:beta-one').length, 1);
} finally {
  if (root !== undefined && !rootUnmounted) {
    await act(async () => {
      root.unmount();
    });
  }
  if (nestedRoot !== undefined && !nestedRootUnmounted) {
    await act(async () => {
      nestedRoot.unmount();
    });
  }
  dom.window.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  delete globalThis.HTMLElement;
  delete globalThis.Node;
  if (originalNavigatorDescriptor === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  delete globalThis.document;
  delete globalThis.window;
}

console.log('React repetition host prototype: PASS');
