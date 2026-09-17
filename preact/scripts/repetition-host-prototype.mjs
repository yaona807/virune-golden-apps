import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Fragment, h, render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { act } from 'preact/test-utils';

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
  const readValue = useCallback(() => currentEntry.current.value, []);
  const readIndex = useCallback(() => currentEntry.current.index, []);
  return renderGroup(readValue, readIndex, entry.id);
}

function RepetitionHostImpl({ readSnapshot, renderGroup }) {
  return validateSnapshot(readSnapshot()).map((entry) => h(RepetitionGroup, {
    key: entry.id,
    entry,
    renderGroup,
  }));
}

function repetitionHost(readSnapshot, renderGroup) {
  return h(RepetitionHostImpl, { readSnapshot, renderGroup });
}

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({
    id,
    index,
    // Reallocate transported values on every snapshot so the proof cannot depend
    // on JavaScript object identity.
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
  return h('button', {
    type: 'button',
    'data-id': `${lifecyclePrefix}${id}`,
    onClick: () => setMark('hot'),
  }, `${value.label}:${index}:${mark}`);
}

function renderStatefulGroup(readValue, readIndex, id) {
  renderCalls.set(id, (renderCalls.get(id) ?? 0) + 1);
  return h(Fragment, null,
    h(StatefulRow, { value: readValue(), index: readIndex(), id }),
    h('span', { 'data-meta-id': id }, `meta:${id}`),
  );
}

function BasicScenario({ snapshot }) {
  return repetitionHost(() => snapshot, renderStatefulGroup);
}

function NestedOuter({ value, index, id }) {
  return h('section', { 'data-outer-id': id },
    h('span', { 'data-outer-label': id }, `${value.label}:${index}`),
    repetitionHost(
      () => value.children,
      (readChildValue, readChildIndex, childId) => h(StatefulRow, {
        value: readChildValue(),
        index: readChildIndex(),
        id: childId,
        lifecyclePrefix: `${id}/`,
      }),
    ),
  );
}

function NestedScenario({ snapshot }) {
  return repetitionHost(
    () => snapshot,
    (readValue, readIndex, id) => h(NestedOuter, {
      value: readValue(),
      index: readIndex(),
      id,
    }),
  );
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

function assertGroupedSiblingOrder(root, expected) {
  assert.deepEqual(
    [...root.querySelectorAll('span[data-meta-id]')].map((node) => node.getAttribute('data-meta-id')),
    expected,
  );
}

assert.throws(() => RepetitionHostImpl({
  readSnapshot: () => makeSnapshot([
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

globalThis.window = dom.window;
globalThis.document = dom.window.document;

let rootMounted = false;
let nestedMounted = false;
try {
  let snapshot = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  rootMounted = true;
  assertOrder(rootElement, ['s:5:alpha', 's:4:beta']);
  assertGroupedSiblingOrder(rootElement, ['s:5:alpha', 's:4:beta']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:0:cold');
  assert.equal(rowText(rootElement, 's:4:beta'), 'beta:1:cold');
  assert.deepEqual(lifecycle, ['mount:s:5:alpha', 'mount:s:4:beta']);

  await act(() => {
    clickRow(dom, rootElement, 's:5:alpha');
  });
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:0:hot');

  snapshot = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  assertOrder(rootElement, ['s:5:alpha', 's:4:beta', 's:5:gamma']);
  assertGroupedSiblingOrder(rootElement, ['s:5:alpha', 's:4:beta', 's:5:gamma']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:0:hot');
  assert.equal(lifecycle.filter((event) => event === 'mount:s:5:alpha').length, 1);

  snapshot = makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  assertOrder(rootElement, ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
  assertGroupedSiblingOrder(rootElement, ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:1:hot');

  snapshot = makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
    ['s:5:gamma', 'gamma'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:4:beta').length, 1);
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 0);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:1:hot');

  snapshot = makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  assertOrder(rootElement, ['s:5:gamma', 's:4:zero', 's:5:alpha']);
  assertGroupedSiblingOrder(rootElement, ['s:5:gamma', 's:4:zero', 's:5:alpha']);
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha:2:hot');

  snapshot = makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha-v2'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  assert.equal(rowText(rootElement, 's:5:alpha'), 'alpha-v2:2:hot');
  assert.equal(lifecycle.filter((event) => event === 'mount:s:5:alpha').length, 1);

  snapshot = makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:delta', 'delta'],
  ]);
  await act(() => {
    render(h(BasicScenario, { snapshot }), rootElement);
  });
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 1);
  assert.equal(rowText(rootElement, 's:5:delta'), 'delta:2:cold');

  assert.ok((renderCalls.get('s:5:alpha') ?? 0) > 1);
  assert.equal(lifecycle.filter((event) => event === 'mount:s:5:alpha').length, 1);

  let nestedSnapshot = makeNestedSnapshot([
    ['s:5:alpha', 'alpha', [
      ['s:9:alpha-one', 'alpha-one'],
      ['s:9:alpha-two', 'alpha-two'],
    ]],
    ['s:4:beta', 'beta', [
      ['s:8:beta-one', 'beta-one'],
    ]],
  ]);
  await act(() => {
    render(h(NestedScenario, { snapshot: nestedSnapshot }), nestedRootElement);
  });
  nestedMounted = true;
  assert.equal(rowText(nestedRootElement, 's:5:alpha/s:9:alpha-one'), 'alpha-one:0:cold');
  await act(() => {
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
  await act(() => {
    render(h(NestedScenario, { snapshot: nestedSnapshot }), nestedRootElement);
  });
  assert.equal(nestedRootElement.querySelector('[data-outer-label="s:5:alpha"]')?.textContent, 'alpha-v2:1');
  assert.equal(rowText(nestedRootElement, 's:5:alpha/s:9:alpha-one'), 'alpha-one-v2:1:hot');
  assert.equal(lifecycle.filter((event) => event === 's:5:alpha/dispose:s:9:alpha-one').length, 0);

  nestedSnapshot = makeNestedSnapshot([
    ['s:4:beta', 'beta-v3', [
      ['s:8:beta-one', 'beta-one-v3'],
    ]],
  ]);
  await act(() => {
    render(h(NestedScenario, { snapshot: nestedSnapshot }), nestedRootElement);
  });
  assert.equal(lifecycle.filter((event) => event === 's:5:alpha/dispose:s:9:alpha-one').length, 1);
  assert.equal(lifecycle.filter((event) => event === 's:5:alpha/dispose:s:9:alpha-two').length, 1);

  await act(() => {
    render(null, rootElement);
  });
  rootMounted = false;
  for (const id of ['s:5:gamma', 's:4:zero', 's:5:delta']) {
    assert.equal(lifecycle.filter((event) => event === `dispose:${id}`).length, 1);
  }
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:4:beta').length, 1);
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 1);

  await act(() => {
    render(null, nestedRootElement);
  });
  nestedMounted = false;
  assert.equal(lifecycle.filter((event) => event === 's:4:beta/dispose:s:8:beta-one').length, 1);
} finally {
  if (rootMounted) render(null, rootElement);
  if (nestedMounted) render(null, nestedRootElement);
  dom.window.close();
  delete globalThis.document;
  delete globalThis.window;
}

console.log('Preact repetition host prototype: PASS');
