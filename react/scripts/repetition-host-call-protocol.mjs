import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useCallback, useRef, useState } from 'react';

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
  return validateSnapshot(readSnapshot()).map((entry) => createElement(RepetitionGroup, {
    key: entry.id,
    entry,
    renderGroup,
  }));
}

function repetitionHost(readSnapshot, renderGroup) {
  return createElement(RepetitionHostImpl, { readSnapshot, renderGroup });
}

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({ id, index, value: { label } }));
}

function StatefulRow({ readValue, readIndex, id }) {
  const [mark, setMark] = useState('cold');
  return createElement('button', {
    type: 'button',
    'data-id': id,
    onClick: () => setMark('hot'),
  }, `${readValue().label}:${readIndex()}:${mark}`);
}

function Scenario({ snapshot }) {
  return repetitionHost(
    () => snapshot,
    (readValue, readIndex, id) => {
      assert.equal(typeof readValue, 'function');
      assert.equal(typeof readIndex, 'function');
      return createElement(StatefulRow, { readValue, readIndex, id });
    },
  );
}

let bodyCalls = 0;
assert.throws(() => RepetitionHostImpl({
  readSnapshot: () => makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:5:alpha', 'alpha-copy'],
  ]),
  renderGroup: () => {
    bodyCalls += 1;
    return null;
  },
}), /duplicate repetition identity: s:5:alpha/);
assert.equal(bodyCalls, 0);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const rootElement = dom.window.document.getElementById('root');
assert.ok(rootElement);
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
try {
  const { createRoot } = await import('react-dom/client');
  root = createRoot(rootElement);

  let snapshot = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]);
  await act(async () => root.render(createElement(Scenario, { snapshot })));
  const alpha = rootElement.querySelector('[data-id="s:5:alpha"]');
  assert.ok(alpha);
  assert.equal(alpha.textContent, 'alpha:0:cold');

  await act(async () => alpha.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(alpha.textContent, 'alpha:0:hot');

  snapshot = makeSnapshot([
    ['s:4:beta', 'beta-v2'],
    ['s:5:alpha', 'alpha-v2'],
  ]);
  await act(async () => root.render(createElement(Scenario, { snapshot })));
  const movedAlpha = rootElement.querySelector('[data-id="s:5:alpha"]');
  assert.ok(movedAlpha);
  assert.equal(movedAlpha.textContent, 'alpha-v2:1:hot');
} finally {
  if (root !== undefined) await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  delete globalThis.HTMLElement;
  delete globalThis.Node;
  if (originalNavigatorDescriptor === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  delete globalThis.document;
  delete globalThis.window;
}

console.log('React repetition host call protocol: PASS');
