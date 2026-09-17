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

function assertOuterOrder(screen, expected) {
  assert.deepEqual(
    Array.from(screen.querySelectorAll('[data-outer-id]'))
      .map((node) => node.getAttribute('data-outer-id')),
    expected,
  );
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
const alphaTwoState = rowSignals.get('s:5:alpha/s:9:alpha-two');
const betaOneState = rowSignals.get('s:4:beta/s:8:beta-one');
assert.ok(alphaOneState);
assert.ok(alphaTwoState);
assert.ok(betaOneState);
await nestedDOM.userEvent(
  byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one'),
  'click',
);
assert.equal(alphaOneState.value, 'hot');

const outerReordered = makeNestedSnapshot([
  ['s:4:beta', 'beta-v2', [
    ['s:8:beta-one', 'beta-one-v2'],
  ]],
  ['s:5:alpha', 'alpha-v2', [
    ['s:9:alpha-one', 'alpha-one-v2'],
    ['s:9:alpha-two', 'alpha-two-v2'],
  ]],
]);
console.log('Qwik diagnostic: outer reorder start');
await replaceSnapshot('nested', outerReordered, nestedDOM.screen, nestedDOM.userEvent);
console.log('Qwik diagnostic: outer reorder complete');
assertOuterOrder(nestedDOM.screen, ['s:4:beta', 's:5:alpha']);
assert.strictEqual(rowSignals.get('s:5:alpha/s:9:alpha-one'), alphaOneState);
assert.strictEqual(rowSignals.get('s:5:alpha/s:9:alpha-two'), alphaTwoState);
assert.strictEqual(rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
assert.equal(byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one').textContent, 'alpha-one-v2:0:hot');
assert.equal(cleanupEvents.length, 0);

const nestedWithoutAlpha = makeNestedSnapshot([
  ['s:4:beta', 'beta-v2', [
    ['s:8:beta-one', 'beta-one-v2'],
  ]],
]);
console.log('Qwik diagnostic: nested delete after outer reorder start');
await replaceSnapshot('nested', nestedWithoutAlpha, nestedDOM.screen, nestedDOM.userEvent);
console.log('Qwik diagnostic: nested delete after outer reorder complete');
assert.strictEqual(rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
assert.equal(cleanupEvents.length, 2);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

nestedRender.cleanup();
await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
assert.equal(cleanupEvents.length, 3);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);
console.log('Qwik outer reorder then nested delete: PASS');
