import { h } from 'preact';
import { useCallback, useRef } from 'preact/hooks';

let renderInvocationCount = 0;

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

export function readRenderInvocationCount() {
  return renderInvocationCount;
}

export function render(readSnapshot, renderGroup) {
  renderInvocationCount += 1;
  return h(RepetitionHostImpl, { readSnapshot, renderGroup });
}
