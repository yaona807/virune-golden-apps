import {
  Fragment,
  componentQrl,
  jsx,
  qrl,
  useSignal,
  useTaskQrl,
} from '@builder.io/qwik';

const moduleUrl = import.meta.url;
const cleanupTaskQrl = qrl(moduleUrl, 'rowCleanupTask');
const markHotQrl = qrl(moduleUrl, 'markHot');

export const rootSignals = new Map();
export const rowSignals = new Map();
export const rowRenderCounts = new Map();
export const cleanupEvents = [];

let nextCleanupToken = 0;

export function validateSnapshot(snapshot) {
  const seen = new Set();
  for (const entry of snapshot) {
    if (seen.has(entry.id)) throw new Error(`duplicate repetition identity: ${entry.id}`);
    seen.add(entry.id);
  }
  return snapshot;
}

export function repetitionHost(snapshot, renderGroup) {
  validateSnapshot(snapshot);
  return snapshot.map((entry) => jsx(Fragment, {
    children: renderGroup(entry.value, entry.index, entry.id),
  }, entry.id));
}

export function rowCleanupTask({ cleanup }) {
  const token = ++nextCleanupToken;
  cleanup(() => cleanupEvents.push(token));
}

export function markHot(_event, element) {
  const identity = element.getAttribute('data-id');
  const signal = rowSignals.get(identity);
  if (!signal) throw new Error(`missing row state for ${identity}`);
  signal.value = 'hot';
}

export function statefulRowRender(props) {
  const mark = useSignal('cold');
  rowSignals.set(props.registryId, mark);
  rowRenderCounts.set(props.registryId, (rowRenderCounts.get(props.registryId) ?? 0) + 1);
  useTaskQrl(cleanupTaskQrl);

  return jsx('button', {
    'data-id': props.registryId,
    onClick$: markHotQrl,
    children: `${props.label}:${props.index}:${mark.value}`,
  });
}

export const StatefulRow = componentQrl(qrl(moduleUrl, 'statefulRowRender'));

function renderStatefulGroup(value, index, id) {
  return [
    jsx(StatefulRow, {
      registryId: id,
      label: value.label,
      index,
    }),
    jsx('span', {
      'data-meta-id': id,
      children: `meta:${id}`,
    }),
  ];
}

function renderNestedGroup(value, index, id) {
  const diagnosticChildren = value.children.filter((entry) => !entry.id.endsWith('-two'));
  return jsx('section', {
    'data-outer-id': id,
    children: [
      jsx('span', {
        'data-outer-label': id,
        children: `${value.label}:${index}`,
      }),
      repetitionHost(diagnosticChildren, (childValue, childIndex, childId) => jsx(StatefulRow, {
        registryId: `${id}/${childId}`,
        label: childValue.label,
        index: childIndex,
      })),
    ],
  });
}

export function rootRender(props) {
  const snapshot = useSignal(props.initialSnapshot);
  rootSignals.set(props.rootKey, snapshot);

  const groups = props.mode === 'nested'
    ? repetitionHost(snapshot.value, renderNestedGroup)
    : repetitionHost(snapshot.value, renderStatefulGroup);

  return jsx('main', {
    'data-root': props.rootKey,
    children: groups,
  });
}

export const PrototypeRoot = componentQrl(qrl(moduleUrl, 'rootRender'));
