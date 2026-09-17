import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { h, render } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
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
  return entries.map(([id, label], index) => ({ id, index, value: { label } }));
}

function StatefulRow({ readValue, readIndex, id }) {
  const [mark, setMark] = useState('cold');
  return h('button', {
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
      return h(StatefulRow, { readValue, readIndex, id });
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
globalThis.window = dom.window;
globalThis.document = dom.window.document;

let mounted = false;
try {
  let snapshot = makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]);
  await act(() => render(h(Scenario, { snapshot }), rootElement));
  mounted = true;
  const alpha = rootElement.querySelector('[data-id="s:5:alpha"]');
  assert.ok(alpha);
  assert.equal(alpha.textContent, 'alpha:0:cold');

  await act(() => alpha.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(alpha.textContent, 'alpha:0:hot');

  snapshot = makeSnapshot([
    ['s:4:beta', 'beta-v2'],
    ['s:5:alpha', 'alpha-v2'],
  ]);
  await act(() => render(h(Scenario, { snapshot }), rootElement));
  const movedAlpha = rootElement.querySelector('[data-id="s:5:alpha"]');
  assert.ok(movedAlpha);
  assert.equal(movedAlpha.textContent, 'alpha-v2:1:hot');
} finally {
  if (mounted) render(null, rootElement);
  dom.window.close();
  delete globalThis.document;
  delete globalThis.window;
}

console.log('Preact repetition host call protocol: PASS');
