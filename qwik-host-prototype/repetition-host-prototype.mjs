import assert from 'node:assert/strict';
import { jsx } from '@builder.io/qwik';
import { createDOM } from '@builder.io/qwik/testing';
import {
  PrototypeRoot,
  cleanupEvents,
  rootSignals,
  rowSignals,
} from './qwik-host-runtime.mjs';

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

async function flushScheduledRender(screen, userEvent) {
  await userEvent(screen, 'click');
}

async function replaceSnapshot(rootKey, nextSnapshot, screen, userEvent) {
  const signal = rootSignals.get(rootKey);
  assert.ok(signal, `missing root signal ${rootKey}`);
  signal.value = nextSnapshot;
  await flushScheduledRender(screen, userEvent);
}

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

const nestedRender = await nestedDOM.render(jsx(PrototypeRoot, {
  rootKey: 'nested',
  mode: 'nested',
  initialSnapshot: nestedInitial,
}));
await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
console.log('Qwik diagnostic: nested initial flush complete');

const alphaOneState = rowSignals.get('s:5:alpha/s:9:alpha-one');
const betaOneState = rowSignals.get('s:4:beta/s:8:beta-one');
assert.ok(alphaOneState);
assert.ok(betaOneState);
await nestedDOM.userEvent(
  byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one'),
  'click',
);
assert.equal(alphaOneState.value, 'hot');
console.log('Qwik diagnostic: nested state click complete');

const nestedWithoutAlpha = makeNestedSnapshot([
  ['s:4:beta', 'beta', [
    ['s:8:beta-one', 'beta-one'],
  ]],
]);
assert.notStrictEqual(nestedWithoutAlpha[0].value, nestedInitial[1].value);
console.log('Qwik diagnostic: nested delete start');
await replaceSnapshot('nested', nestedWithoutAlpha, nestedDOM.screen, nestedDOM.userEvent);
console.log('Qwik diagnostic: nested delete complete');

assert.equal(byAttr(nestedDOM.screen, 'data-id', 's:4:beta/s:8:beta-one').textContent, 'beta-one:0:cold');
assert.strictEqual(rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
assert.equal(cleanupEvents.length, 2);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

nestedRender.cleanup();
await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
console.log('Qwik diagnostic: nested cleanup complete');
assert.equal(cleanupEvents.length, 3);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

console.log('Qwik nested delete without reorder: PASS');
