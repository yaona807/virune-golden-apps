import assert from 'node:assert/strict';
import { createMemo, createRoot, createSignal, mapArray, onCleanup } from 'solid-js';

function validateSnapshot(snapshot) {
  const seen = new Set();
  for (const entry of snapshot) {
    if (seen.has(entry.id)) throw new Error(`duplicate repetition identity: ${entry.id}`);
    seen.add(entry.id);
  }
  return snapshot;
}

function repetitionHost(readSnapshot, renderGroup) {
  const validatedSnapshot = createMemo(() => validateSnapshot(readSnapshot()));
  const entriesById = createMemo(() => new Map(validatedSnapshot().map((entry) => [entry.id, entry])));
  const orderedIds = createMemo(() => validatedSnapshot().map((entry) => entry.id));

  return mapArray(orderedIds, (id) => {
    const initial = entriesById().get(id);
    if (initial === undefined) throw new Error(`missing repetition entry for ${id}`);

    let lastEntry = initial;
    const currentEntry = createMemo(() => {
      const next = entriesById().get(id);
      if (next !== undefined) lastEntry = next;
      return lastEntry;
    });

    return renderGroup(
      () => currentEntry().value,
      () => currentEntry().index,
      id,
    );
  });
}

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({
    id,
    index,
    // Deliberately allocate a fresh object on every snapshot. Reconciliation must
    // depend only on id, never on transported value object identity.
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

function assertGroupState(groups, expected) {
  assert.deepEqual(
    groups().map((group) => ({
      id: group.id,
      label: group.label(),
      index: group.currentIndex(),
      mark: group.mark(),
    })),
    expected,
  );
}

const lifecycle = [];
let disposeRoot;

createRoot((dispose) => {
  disposeRoot = dispose;

  const [snapshot, setSnapshot] = createSignal(makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]));

  const groups = repetitionHost(snapshot, (readValue, readIndex, id) => {
    lifecycle.push(`create:${id}`);
    const [mark, setMark] = createSignal('cold');
    onCleanup(() => lifecycle.push(`dispose:${id}`));
    return {
      id,
      label: () => readValue().label,
      currentIndex: () => readIndex(),
      mark,
      setMark,
    };
  });

  assertGroupState(groups, [
    { id: 's:5:alpha', label: 'alpha', index: 0, mark: 'cold' },
    { id: 's:4:beta', label: 'beta', index: 1, mark: 'cold' },
  ]);

  const alpha = groups().find((group) => group.id === 's:5:alpha');
  const beta = groups().find((group) => group.id === 's:4:beta');
  assert.ok(alpha);
  assert.ok(beta);
  alpha.setMark('hot');

  // Append: surviving groups must be reused even though every transported value
  // object is freshly allocated.
  setSnapshot(makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]));
  assert.strictEqual(groups().find((group) => group.id === 's:5:alpha'), alpha);
  assert.strictEqual(groups().find((group) => group.id === 's:4:beta'), beta);
  assertGroupState(groups, [
    { id: 's:5:alpha', label: 'alpha', index: 0, mark: 'hot' },
    { id: 's:4:beta', label: 'beta', index: 1, mark: 'cold' },
    { id: 's:5:gamma', label: 'gamma', index: 2, mark: 'cold' },
  ]);

  // Prepend: state follows identity, while the body-derived index tracks the current snapshot.
  setSnapshot(makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
    ['s:5:gamma', 'gamma'],
  ]));
  assert.strictEqual(groups().find((group) => group.id === 's:5:alpha'), alpha);
  assertGroupState(groups, [
    { id: 's:4:zero', label: 'zero', index: 0, mark: 'cold' },
    { id: 's:5:alpha', label: 'alpha', index: 1, mark: 'hot' },
    { id: 's:4:beta', label: 'beta', index: 2, mark: 'cold' },
    { id: 's:5:gamma', label: 'gamma', index: 3, mark: 'cold' },
  ]);

  // Delete beta. Only beta is disposed; alpha remains the same stateful group.
  setSnapshot(makeSnapshot([
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
    ['s:5:gamma', 'gamma'],
  ]));
  assert.strictEqual(groups().find((group) => group.id === 's:5:alpha'), alpha);
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:4:beta').length, 1);
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 0);

  // Reorder: all surviving group objects are reused, with updated indexes.
  const zero = groups().find((group) => group.id === 's:4:zero');
  const gamma = groups().find((group) => group.id === 's:5:gamma');
  assert.ok(zero);
  assert.ok(gamma);
  setSnapshot(makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha'],
  ]));
  assert.strictEqual(groups()[0], gamma);
  assert.strictEqual(groups()[1], zero);
  assert.strictEqual(groups()[2], alpha);
  assertGroupState(groups, [
    { id: 's:5:gamma', label: 'gamma', index: 0, mark: 'cold' },
    { id: 's:4:zero', label: 'zero', index: 1, mark: 'cold' },
    { id: 's:5:alpha', label: 'alpha', index: 2, mark: 'hot' },
  ]);

  // Same identity + changed value updates the body-derived value without recreating the group.
  setSnapshot(makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:alpha', 'alpha-v2'],
  ]));
  assert.strictEqual(groups()[2], alpha);
  assert.equal(alpha.label(), 'alpha-v2');
  assert.equal(alpha.mark(), 'hot');

  // Identity transition A -> B is remove + add. State must not transfer.
  setSnapshot(makeSnapshot([
    ['s:5:gamma', 'gamma'],
    ['s:4:zero', 'zero'],
    ['s:5:delta', 'delta'],
  ]));
  const delta = groups().find((group) => group.id === 's:5:delta');
  assert.ok(delta);
  assert.notStrictEqual(delta, alpha);
  assert.equal(delta.mark(), 'cold');
  assert.equal(lifecycle.filter((event) => event === 'dispose:s:5:alpha').length, 1);
});

assert.ok(disposeRoot);
disposeRoot();
for (const id of ['s:4:zero', 's:5:gamma', 's:5:delta']) {
  assert.equal(lifecycle.filter((event) => event === `dispose:${id}`).length, 1);
}

// Duplicate identity is a fail-closed input error. Run this in a separate root so
// the deliberately invalid snapshot cannot poison the main lifecycle scenario.
assert.throws(() => {
  createRoot((dispose) => {
    const [snapshot] = createSignal(makeSnapshot([
      ['s:5:alpha', 'alpha'],
      ['s:5:alpha', 'alpha-copy'],
    ]));
    const groups = repetitionHost(snapshot, (readValue, readIndex, id) => ({
      id,
      label: () => readValue().label,
      currentIndex: () => readIndex(),
    }));
    try {
      groups();
    } finally {
      dispose();
    }
  });
}, /duplicate repetition identity: s:5:alpha/);

// Nested repetition must compose without introducing a second identity model.
// Reordering both levels preserves child state; removing a parent disposes its
// nested groups exactly once through Solid's ordinary owner hierarchy.
const nestedLifecycle = [];
let disposeNestedRoot;
createRoot((dispose) => {
  disposeNestedRoot = dispose;
  const [snapshot, setSnapshot] = createSignal(makeNestedSnapshot([
    ['s:5:alpha', 'alpha', [
      ['s:9:alpha-one', 'alpha-one'],
      ['s:9:alpha-two', 'alpha-two'],
    ]],
    ['s:4:beta', 'beta', [
      ['s:8:beta-one', 'beta-one'],
    ]],
  ]));

  const groups = repetitionHost(snapshot, (readValue, readIndex, id) => {
    nestedLifecycle.push(`outer-create:${id}`);
    onCleanup(() => nestedLifecycle.push(`outer-dispose:${id}`));
    const children = repetitionHost(
      createMemo(() => readValue().children),
      (readChildValue, readChildIndex, childId) => {
        nestedLifecycle.push(`child-create:${id}/${childId}`);
        const [mark, setMark] = createSignal('cold');
        onCleanup(() => nestedLifecycle.push(`child-dispose:${id}/${childId}`));
        return {
          id: childId,
          label: () => readChildValue().label,
          currentIndex: () => readChildIndex(),
          mark,
          setMark,
        };
      },
    );
    return {
      id,
      label: () => readValue().label,
      currentIndex: () => readIndex(),
      children,
    };
  });

  const alpha = groups().find((group) => group.id === 's:5:alpha');
  const beta = groups().find((group) => group.id === 's:4:beta');
  assert.ok(alpha);
  assert.ok(beta);
  const alphaOne = alpha.children().find((group) => group.id === 's:9:alpha-one');
  const betaOne = beta.children().find((group) => group.id === 's:8:beta-one');
  assert.ok(alphaOne);
  assert.ok(betaOne);
  alphaOne.setMark('hot');

  setSnapshot(makeNestedSnapshot([
    ['s:4:beta', 'beta-v2', [
      ['s:8:beta-one', 'beta-one-v2'],
    ]],
    ['s:5:alpha', 'alpha-v2', [
      ['s:9:alpha-two', 'alpha-two-v2'],
      ['s:9:alpha-one', 'alpha-one-v2'],
    ]],
  ]));

  const movedAlpha = groups().find((group) => group.id === 's:5:alpha');
  const movedBeta = groups().find((group) => group.id === 's:4:beta');
  assert.strictEqual(movedAlpha, alpha);
  assert.strictEqual(movedBeta, beta);
  assert.equal(alpha.currentIndex(), 1);
  assert.equal(alpha.label(), 'alpha-v2');
  const movedAlphaOne = alpha.children().find((group) => group.id === 's:9:alpha-one');
  const movedBetaOne = beta.children().find((group) => group.id === 's:8:beta-one');
  assert.strictEqual(movedAlphaOne, alphaOne);
  assert.strictEqual(movedBetaOne, betaOne);
  assert.equal(alphaOne.currentIndex(), 1);
  assert.equal(alphaOne.label(), 'alpha-one-v2');
  assert.equal(alphaOne.mark(), 'hot');
  assert.equal(betaOne.label(), 'beta-one-v2');

  setSnapshot(makeNestedSnapshot([
    ['s:4:beta', 'beta-v3', [
      ['s:8:beta-one', 'beta-one-v3'],
    ]],
  ]));
  assert.deepEqual(groups().map((group) => group.id), ['s:4:beta']);
  assert.equal(nestedLifecycle.filter((event) => event === 'outer-dispose:s:5:alpha').length, 1);
  assert.equal(nestedLifecycle.filter((event) => event === 'child-dispose:s:5:alpha/s:9:alpha-one').length, 1);
  assert.equal(nestedLifecycle.filter((event) => event === 'child-dispose:s:5:alpha/s:9:alpha-two').length, 1);
});

assert.ok(disposeNestedRoot);
disposeNestedRoot();
assert.equal(nestedLifecycle.filter((event) => event === 'outer-dispose:s:4:beta').length, 1);
assert.equal(nestedLifecycle.filter((event) => event === 'child-dispose:s:4:beta/s:8:beta-one').length, 1);

console.log('Solid repetition host prototype: PASS');
