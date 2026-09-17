import { Fragment, component$, useSignal, useTask$ } from '@builder.io/qwik';

export const rootSignals = new Map();
export const rowSignals = new Map();
export const cleanupEvents = [];

export function validateSnapshot(snapshot) {
  const seen = new Set();
  for (const entry of snapshot) {
    if (seen.has(entry.id)) {
      throw new Error(`duplicate repetition identity: ${entry.id}`);
    }
    seen.add(entry.id);
  }
  return snapshot;
}

function keyGroup(id, group) {
  return <Fragment key={id}>{group}</Fragment>;
}

export function repetitionHost(readSnapshot, renderGroup) {
  const snapshot = validateSnapshot(readSnapshot());
  return snapshot.map((entry) => keyGroup(
    entry.id,
    renderGroup(
      () => entry.value,
      () => entry.index,
      entry.id,
    ),
  ));
}

export const StatefulRow = component$((props) => {
  const mark = useSignal('cold');
  rowSignals.set(props.registryId, mark);

  useTask$(({ cleanup }) => {
    const identity = props.registryId;
    cleanup(() => cleanupEvents.push(identity));
  });

  return (
    <button
      data-id={props.registryId}
      onClick$={() => {
        mark.value = 'hot';
      }}
    >
      {props.value.label}:{props.index}:{mark.value}
    </button>
  );
});

export const PrototypeRoot = component$((props) => {
  const snapshot = useSignal(props.initialSnapshot);
  rootSignals.set(props.rootKey, snapshot);

  const groups = props.mode === 'nested'
    ? repetitionHost(() => snapshot.value, (readValue, readIndex, id) => (
        <section data-outer-id={id}>
          <span data-outer-label={id}>{readValue().label}:{readIndex()}</span>
          {repetitionHost(() => readValue().children, (readChildValue, readChildIndex, childId) => (
            <StatefulRow
              registryId={`${id}/${childId}`}
              value={readChildValue()}
              index={readChildIndex()}
            />
          ))}
        </section>
      ))
    : repetitionHost(() => snapshot.value, (readValue, readIndex, id) => (
        <Fragment>
          <StatefulRow registryId={id} value={readValue()} index={readIndex()} />
          <span data-meta-id={id}>meta:{id}</span>
        </Fragment>
      ));

  return <main data-root={props.rootKey}>{groups}</main>;
});
