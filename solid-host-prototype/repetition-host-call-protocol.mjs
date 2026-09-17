import assert from 'node:assert/strict';
import { createMemo, createRoot, createSignal, mapArray } from 'solid-js';

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
  return entries.map(([id, label], index) => ({ id, index, value: { label } }));
}

createRoot((dispose) => {
  const [snapshot, setSnapshot] = createSignal(makeSnapshot([
    ['s:5:alpha', 'alpha'],
    ['s:4:beta', 'beta'],
  ]));

  const groups = repetitionHost(snapshot, (readValue, readIndex, id) => {
    assert.equal(typeof readValue, 'function');
    assert.equal(typeof readIndex, 'function');
    return { id, readValue, readIndex };
  });

  const alpha = groups().find((group) => group.id === 's:5:alpha');
  assert.ok(alpha);
  assert.equal(alpha.readValue().label, 'alpha');
  assert.equal(alpha.readIndex(), 0);

  setSnapshot(makeSnapshot([
    ['s:4:beta', 'beta-v2'],
    ['s:5:alpha', 'alpha-v2'],
  ]));

  const movedAlpha = groups().find((group) => group.id === 's:5:alpha');
  assert.strictEqual(movedAlpha, alpha);
  assert.equal(alpha.readValue().label, 'alpha-v2');
  assert.equal(alpha.readIndex(), 1);

  dispose();
});

assert.throws(() => createRoot((dispose) => {
  try {
    const groups = repetitionHost(
      () => makeSnapshot([
        ['s:5:alpha', 'alpha'],
        ['s:5:alpha', 'alpha-copy'],
      ]),
      () => null,
    );
    groups();
  } finally {
    dispose();
  }
}), /duplicate repetition identity: s:5:alpha/);

console.log('Solid repetition host call protocol: PASS');
