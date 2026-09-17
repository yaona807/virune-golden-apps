import assert from 'node:assert/strict';
import { jsx } from '@builder.io/qwik';
import { createDOM } from '@builder.io/qwik/testing';
import {
  PrototypeRoot,
  cleanupEvents,
  repetitionHost,
  rootSignals,
  rowRenderCounts,
  rowSignals,
} from './qwik-host-runtime.mjs';

function diagnostic(phase) {
  console.log(`Qwik diagnostic: ${phase}`);
}

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({
    id,
    index,
    // Fresh transported value object on every snapshot. Logical identity is only id.
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

function byAttr(screen, attribute, value) {
  const node = Array.from(screen.querySelectorAll(`[${attribute}]`))
    .find((candidate) => candidate.getAttribute(attribute) === value);
  assert.ok(node, `missing ${attribute}=${value}`);
  return node;
}

function maybeByAttr(screen, attribute, value) {
  return Array.from(screen.querySelectorAll(`[${attribute}]`))
    .find((candidate) => candidate.getAttribute(attribute) === value);
}

function assertOrder(screen, attribute, expected) {
  assert.deepEqual(
    Array.from(screen.querySelectorAll(`[${attribute}]`))
      .map((node) => node.getAttribute(attribute)),
    expected,
  );
}

function assertRow(screen, id, expectedText) {
  assert.equal(byAttr(screen, 'data-id', id).textContent, expectedText);
}

async function flushScheduledRender(screen, userEvent) {
  // Public Qwik testing userEvent flushes the test platform after dispatch.
  // The dispatch itself is intentionally inert when pointed at the root host.
  await userEvent(screen, 'click');
}

async function replaceSnapshot(rootKey, nextSnapshot, screen, userEvent) {
  const signal = rootSignals.get(rootKey);
  assert.ok(signal, `missing root signal ${rootKey}`);
  signal.value = nextSnapshot;
  await flushScheduledRender(screen, userEvent);
}

async function cleanupRender(result, screen, userEvent) {
  result.cleanup();
  await flushScheduledRender(screen, userEvent);
}

// Duplicate ids must fail before any keyed group output or body invocation exists.
{
  let bodyCalls = 0;
  assert.throws(
    () => repetitionHost([
      { id: 's:5:alpha', index: 0, value: { label: 'alpha' } },
      { id: 's:5:alpha', index: 1, value: { label: 'alpha-copy' } },
    ], () => {
      bodyCalls += 1;
      return null;
    }),
    /duplicate repetition identity: s:5:alpha/,
  );
  assert.equal(bodyCalls, 0);
}
diagnostic('duplicate validation complete');

const flatDOM = await createDOM();
diagnostic('flat createDOM complete');
const flatInitial = makeSnapshot([
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
]);
const flatRender = await flatDOM.render(jsx(PrototypeRoot, {
  rootKey: 'flat',
  mode: 'flat',
  initialSnapshot: flatInitial,
}));
diagnostic('flat initial render complete');
await flushScheduledRender(flatDOM.screen, flatDOM.userEvent);
diagnostic('flat initial flush complete');

assertOrder(flatDOM.screen, 'data-id', ['s:5:alpha', 's:4:beta']);
assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:alpha', 's:4:beta']);
assertRow(flatDOM.screen, 's:5:alpha', 'alpha:0:cold');
assertRow(flatDOM.screen, 's:4:beta', 'beta:1:cold');
assert.equal(cleanupEvents.length, 0);

const alphaState = rowSignals.get('s:5:alpha');
const betaState = rowSignals.get('s:4:beta');
assert.ok(alphaState);
assert.ok(betaState);
await flatDOM.userEvent(byAttr(flatDOM.screen, 'data-id', 's:5:alpha'), 'click');
diagnostic('flat state click complete');
assert.equal(alphaState.value, 'hot');
assertRow(flatDOM.screen, 's:5:alpha', 'alpha:0:hot');

// Append: surviving component-local state remains attached to opaque id.
const appended = makeSnapshot([
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
  ['s:5:gamma', 'gamma'],
]);
assert.notStrictEqual(appended[0].value, flatInitial[0].value);
await replaceSnapshot('flat', appended, flatDOM.screen, flatDOM.userEvent);
diagnostic('append complete');
assertOrder(flatDOM.screen, 'data-id', ['s:5:alpha', 's:4:beta', 's:5:gamma']);
assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:alpha', 's:4:beta', 's:5:gamma']);
assert.strictEqual(rowSignals.get('s:5:alpha'), alphaState);
assert.strictEqual(rowSignals.get('s:4:beta'), betaState);
assertRow(flatDOM.screen, 's:5:alpha', 'alpha:0:hot');
assert.equal(cleanupEvents.length, 0);

const gammaState = rowSignals.get('s:5:gamma');
assert.ok(gammaState);

// Prepend: current index changes while surviving state stays with the same id.
const prepended = makeSnapshot([
  ['s:4:zero', 'zero'],
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
  ['s:5:gamma', 'gamma'],
]);
assert.notStrictEqual(prepended[1].value, appended[0].value);
await replaceSnapshot('flat', prepended, flatDOM.screen, flatDOM.userEvent);
diagnostic('prepend complete');
assertOrder(flatDOM.screen, 'data-id', ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
assertOrder(flatDOM.screen, 'data-meta-id', ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
assert.strictEqual(rowSignals.get('s:5:alpha'), alphaState);
assertRow(flatDOM.screen, 's:5:alpha', 'alpha:1:hot');
assert.equal(cleanupEvents.length, 0);

const zeroState = rowSignals.get('s:4:zero');
assert.ok(zeroState);

// Delete: the removed group disappears and exactly one lifecycle cleanup runs.
const withoutBeta = makeSnapshot([
  ['s:4:zero', 'zero'],
  ['s:5:alpha', 'alpha'],
  ['s:5:gamma', 'gamma'],
]);
await replaceSnapshot('flat', withoutBeta, flatDOM.screen, flatDOM.userEvent);
diagnostic('delete complete');
assert.equal(maybeByAttr(flatDOM.screen, 'data-id', 's:4:beta'), undefined);
assert.equal(maybeByAttr(flatDOM.screen, 'data-meta-id', 's:4:beta'), undefined);
assert.strictEqual(rowSignals.get('s:5:alpha'), alphaState);
assert.strictEqual(rowSignals.get('s:5:gamma'), gammaState);
assert.equal(cleanupEvents.length, 1);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

// Reorder: both siblings move as one keyed logical group and local state survives.
const reordered = makeSnapshot([
  ['s:5:gamma', 'gamma'],
  ['s:5:alpha', 'alpha'],
  ['s:4:zero', 'zero'],
]);
await replaceSnapshot('flat', reordered, flatDOM.screen, flatDOM.userEvent);
diagnostic('reorder complete');
assertOrder(flatDOM.screen, 'data-id', ['s:5:gamma', 's:5:alpha', 's:4:zero']);
assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:gamma', 's:5:alpha', 's:4:zero']);
assert.strictEqual(rowSignals.get('s:5:gamma'), gammaState);
assert.strictEqual(rowSignals.get('s:5:alpha'), alphaState);
assert.strictEqual(rowSignals.get('s:4:zero'), zeroState);
assertRow(flatDOM.screen, 's:5:alpha', 'alpha:1:hot');
assert.equal(cleanupEvents.length, 1);

// Same-id value replacement exposes the current fresh value without resetting state.
const valueUpdated = makeSnapshot([
  ['s:5:gamma', 'gamma-v2'],
  ['s:5:alpha', 'alpha-v2'],
  ['s:4:zero', 'zero-v2'],
]);
assert.notStrictEqual(valueUpdated[1].value, reordered[1].value);
await replaceSnapshot('flat', valueUpdated, flatDOM.screen, flatDOM.userEvent);
diagnostic('same-id update complete');
assert.strictEqual(rowSignals.get('s:5:alpha'), alphaState);
assertRow(flatDOM.screen, 's:5:alpha', 'alpha-v2:1:hot');
assertRow(flatDOM.screen, 's:5:gamma', 'gamma-v2:0:cold');
assert.equal(cleanupEvents.length, 1);

// Identity replacement is remove + add: no state transfers to the new identity.
const replacedIdentity = makeSnapshot([
  ['s:5:gamma', 'gamma-v3'],
  ['s:5:delta', 'delta'],
  ['s:4:zero', 'zero-v3'],
]);
await replaceSnapshot('flat', replacedIdentity, flatDOM.screen, flatDOM.userEvent);
diagnostic('identity replacement complete');
assert.equal(maybeByAttr(flatDOM.screen, 'data-id', 's:5:alpha'), undefined);
assert.equal(maybeByAttr(flatDOM.screen, 'data-meta-id', 's:5:alpha'), undefined);
assertOrder(flatDOM.screen, 'data-id', ['s:5:gamma', 's:5:delta', 's:4:zero']);
assertOrder(flatDOM.screen, 'data-meta-id', ['s:5:gamma', 's:5:delta', 's:4:zero']);
const deltaState = rowSignals.get('s:5:delta');
assert.ok(deltaState);
assert.notStrictEqual(deltaState, alphaState);
assert.equal(deltaState.value, 'cold');
assertRow(flatDOM.screen, 's:5:delta', 'delta:1:cold');
assert.equal(cleanupEvents.length, 2);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

await cleanupRender(flatRender, flatDOM.screen, flatDOM.userEvent);
diagnostic('flat cleanup complete');
// beta + alpha were removed during updates; gamma + delta + zero are current at root cleanup.
assert.equal(cleanupEvents.length, 5);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

// Nested repetition composes the same opaque-id Host contract at both levels.
const nestedDOM = await createDOM();
diagnostic('nested createDOM complete');
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
diagnostic('nested initial render complete');
await flushScheduledRender(nestedDOM.screen, nestedDOM.userEvent);
diagnostic('nested initial flush complete');
assertOrder(nestedDOM.screen, 'data-outer-id', ['s:5:alpha', 's:4:beta']);
assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-one', 'alpha-one:0:cold');

const alphaOneState = rowSignals.get('s:5:alpha/s:9:alpha-one');
const betaOneState = rowSignals.get('s:4:beta/s:8:beta-one');
assert.ok(alphaOneState);
assert.ok(betaOneState);
await nestedDOM.userEvent(
  byAttr(nestedDOM.screen, 'data-id', 's:5:alpha/s:9:alpha-one'),
  'click',
);
diagnostic('nested state click complete');
assert.equal(alphaOneState.value, 'hot');
assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-one', 'alpha-one:0:hot');

const nestedReordered = makeNestedSnapshot([
  ['s:4:beta', 'beta-v2', [
    ['s:8:beta-one', 'beta-one-v2'],
  ]],
  ['s:5:alpha', 'alpha-v2', [
    ['s:9:alpha-two', 'alpha-two-v2'],
    ['s:9:alpha-one', 'alpha-one-v2'],
  ]],
]);
assert.notStrictEqual(
  nestedReordered[1].value.children[1].value,
  nestedInitial[0].value.children[0].value,
);
await replaceSnapshot('nested', nestedReordered, nestedDOM.screen, nestedDOM.userEvent);
diagnostic('nested reorder complete');
assertOrder(nestedDOM.screen, 'data-outer-id', ['s:4:beta', 's:5:alpha']);
assert.strictEqual(rowSignals.get('s:5:alpha/s:9:alpha-one'), alphaOneState);
assert.strictEqual(rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
assertRow(nestedDOM.screen, 's:5:alpha/s:9:alpha-one', 'alpha-one-v2:1:hot');
assert.equal(cleanupEvents.length, 5);

// Removing one outer identity removes both of its current nested children exactly once.
// Keep surviving props equal to the prior snapshot here to isolate deletion from a concurrent
// survivor-prop update while still allocating a fresh transported value object.
const nestedWithoutAlpha = makeNestedSnapshot([
  ['s:4:beta', 'beta-v2', [
    ['s:8:beta-one', 'beta-one-v2'],
  ]],
]);
assert.notStrictEqual(nestedWithoutAlpha[0].value, nestedReordered[0].value);
await replaceSnapshot('nested', nestedWithoutAlpha, nestedDOM.screen, nestedDOM.userEvent);
diagnostic('nested delete complete');
assert.equal(maybeByAttr(nestedDOM.screen, 'data-outer-id', 's:5:alpha'), undefined);
assert.strictEqual(rowSignals.get('s:4:beta/s:8:beta-one'), betaOneState);
assertRow(nestedDOM.screen, 's:4:beta/s:8:beta-one', 'beta-one-v2:0:cold');
assert.equal(cleanupEvents.length, 7);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

await cleanupRender(nestedRender, nestedDOM.screen, nestedDOM.userEvent);
diagnostic('nested cleanup complete');
assert.equal(cleanupEvents.length, 8);
assert.equal(new Set(cleanupEvents).size, cleanupEvents.length);

// Qwik is free to re-enter component render functions. Their exact invocation count is evidence only,
// never part of the portable Virune Host contract.
for (const count of rowRenderCounts.values()) assert.ok(count >= 1);

console.log('Qwik repetition Host prototype: PASS');
console.log('Qwik observation: signal-driven reconciliation preserved opaque-id state; exact render/task scheduling is intentionally non-portable.');
