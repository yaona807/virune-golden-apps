import assert from 'node:assert/strict';
import {
  Fragment,
  createRenderer,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
} from 'vue';

function rootNode() {
  return { kind: 'root', parent: null, children: [], props: Object.create(null), text: '' };
}

function detach(node) {
  if (node.parent === null) return;
  const siblings = node.parent.children;
  const index = siblings.indexOf(node);
  if (index >= 0) siblings.splice(index, 1);
  node.parent = null;
}

function insert(node, parent, anchor = null) {
  detach(node);
  node.parent = parent;
  parent.text = '';
  if (anchor === null) parent.children.push(node);
  else {
    const index = parent.children.indexOf(anchor);
    assert.notEqual(index, -1, 'Vue renderer supplied an anchor outside the target parent');
    parent.children.splice(index, 0, node);
  }
}

const renderer = createRenderer({
  patchProp(node, key, _previous, next) {
    if (next === null || next === undefined) delete node.props[key];
    else node.props[key] = next;
  },
  insert,
  remove(node) {
    detach(node);
  },
  createElement(tag) {
    return { kind: 'element', tag, parent: null, children: [], props: Object.create(null), text: '' };
  },
  createText(text) {
    return { kind: 'text', parent: null, children: [], props: Object.create(null), text };
  },
  createComment(text) {
    return { kind: 'comment', parent: null, children: [], props: Object.create(null), text };
  },
  setText(node, text) {
    node.text = text;
  },
  setElementText(node, text) {
    for (const child of node.children) child.parent = null;
    node.children = [];
    node.text = text;
  },
  parentNode(node) {
    return node.parent;
  },
  nextSibling(node) {
    if (node.parent === null) return null;
    const siblings = node.parent.children;
    const index = siblings.indexOf(node);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  },
  querySelector() {
    return null;
  },
  setScopeId() {},
  insertStaticContent(content, parent, anchor) {
    const node = { kind: 'text', parent: null, children: [], props: Object.create(null), text: content };
    insert(node, parent, anchor ?? null);
    return [node, node];
  },
});

function validateSnapshot(snapshot) {
  const seen = new Set();
  for (const entry of snapshot) {
    if (seen.has(entry.id)) throw new Error(`duplicate repetition identity: ${entry.id}`);
    seen.add(entry.id);
  }
  return snapshot;
}

const RepetitionGroup = {
  props: ['entry', 'renderGroup'],
  setup(props) {
    const readValue = () => props.entry.value;
    const readIndex = () => props.entry.index;
    return () => props.renderGroup(readValue, readIndex, props.entry.id);
  },
};

const RepetitionHostImpl = {
  props: ['readSnapshot', 'renderGroup'],
  setup(props) {
    return () => validateSnapshot(props.readSnapshot()).map((entry) => h(RepetitionGroup, {
      key: entry.id,
      entry,
      renderGroup: props.renderGroup,
    }));
  },
};

function repetitionHost(readSnapshot, renderGroup) {
  return h(RepetitionHostImpl, { readSnapshot, renderGroup });
}

function makeSnapshot(entries) {
  return entries.map(([id, label], index) => ({
    id,
    index,
    // Allocate a fresh object every time. Vue identity must come from opaque id.
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

const lifecycle = [];
const renderCalls = new Map();

const StatefulRow = {
  props: ['value', 'index', 'identity', 'lifecyclePrefix'],
  setup(props) {
    const mark = ref('cold');
    const prefix = props.lifecyclePrefix ?? '';
    onMounted(() => lifecycle.push(`${prefix}mount:${props.identity}`));
    onUnmounted(() => lifecycle.push(`${prefix}dispose:${props.identity}`));
    return () => h('button', {
      'data-id': `${prefix}${props.identity}`,
      onClick: () => { mark.value = 'hot'; },
    }, `${props.value.label}:${props.index}:${mark.value}`);
  },
};

function renderStatefulGroup(readValue, readIndex, id) {
  renderCalls.set(id, (renderCalls.get(id) ?? 0) + 1);
  return h(Fragment, null, [
    h(StatefulRow, { value: readValue(), index: readIndex(), identity: id }),
    h('span', { 'data-meta-id': id }, `meta:${id}`),
  ]);
}

const NestedOuter = {
  props: ['value', 'index', 'identity'],
  setup(props) {
    return () => h('section', { 'data-outer-id': props.identity }, [
      h('span', { 'data-outer-label': props.identity }, `${props.value.label}:${props.index}`),
      repetitionHost(
        () => props.value.children,
        (readChildValue, readChildIndex, childId) => h(StatefulRow, {
          value: readChildValue(),
          index: readChildIndex(),
          identity: childId,
          lifecyclePrefix: `${props.identity}/`,
        }),
      ),
    ]);
  },
};

function nestedRenderGroup(readValue, readIndex, id) {
  return h(NestedOuter, { value: readValue(), index: readIndex(), identity: id });
}

function descendants(node, predicate, output = []) {
  if (predicate(node)) output.push(node);
  for (const child of node.children) descendants(child, predicate, output);
  return output;
}

function byDataId(root, id) {
  const node = descendants(root, candidate => candidate.props?.['data-id'] === id)[0];
  assert.ok(node, `missing node ${id}`);
  return node;
}

function textOf(node) {
  if (node.kind === 'comment') return '';
  return node.text + node.children.map(textOf).join('');
}

function assertOrder(root, attribute, expected) {
  assert.deepEqual(
    descendants(root, node => node.props?.[attribute] !== undefined).map(node => node.props[attribute]),
    expected,
  );
}

async function click(root, id) {
  const node = byDataId(root, id);
  assert.equal(typeof node.props.onClick, 'function');
  node.props.onClick();
  await nextTick();
}

// Duplicate ids fail before any repetition group can mount.
{
  const container = rootNode();
  let captured;
  const app = renderer.createApp({
    setup: () => () => repetitionHost(
      () => makeSnapshot([
        ['s:5:alpha', 'alpha'],
        ['s:5:alpha', 'alpha-copy'],
      ]),
      renderStatefulGroup,
    ),
  });
  app.config.errorHandler = error => { captured = error; };
  app.mount(container);
  await nextTick();
  assert.match(String(captured), /duplicate repetition identity: s:5:alpha/);
  assert.equal(renderCalls.size, 0);
  assert.equal(lifecycle.length, 0);
  app.unmount();
}

const container = rootNode();
const snapshot = ref(makeSnapshot([
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
]));
const app = renderer.createApp({
  setup: () => () => repetitionHost(() => snapshot.value, renderStatefulGroup),
});
app.mount(container);
await nextTick();
assertOrder(container, 'data-id', ['s:5:alpha', 's:4:beta']);
assertOrder(container, 'data-meta-id', ['s:5:alpha', 's:4:beta']);
assert.equal(textOf(byDataId(container, 's:5:alpha')), 'alpha:0:cold');
assert.deepEqual(lifecycle, ['mount:s:5:alpha', 'mount:s:4:beta']);

await click(container, 's:5:alpha');
assert.equal(textOf(byDataId(container, 's:5:alpha')), 'alpha:0:hot');

snapshot.value = makeSnapshot([
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
  ['s:5:gamma', 'gamma'],
]);
await nextTick();
assertOrder(container, 'data-id', ['s:5:alpha', 's:4:beta', 's:5:gamma']);
assertOrder(container, 'data-meta-id', ['s:5:alpha', 's:4:beta', 's:5:gamma']);
assert.equal(textOf(byDataId(container, 's:5:alpha')), 'alpha:0:hot');
assert.equal(lifecycle.filter(event => event === 'mount:s:5:alpha').length, 1);

snapshot.value = makeSnapshot([
  ['s:4:zero', 'zero'],
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
  ['s:5:gamma', 'gamma'],
]);
await nextTick();
assertOrder(container, 'data-id', ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
assertOrder(container, 'data-meta-id', ['s:4:zero', 's:5:alpha', 's:4:beta', 's:5:gamma']);
assert.equal(textOf(byDataId(container, 's:5:alpha')), 'alpha:1:hot');

snapshot.value = makeSnapshot([
  ['s:4:zero', 'zero'],
  ['s:5:alpha', 'alpha'],
  ['s:5:gamma', 'gamma'],
]);
await nextTick();
assert.equal(lifecycle.filter(event => event === 'dispose:s:4:beta').length, 1);
assert.equal(lifecycle.filter(event => event === 'dispose:s:5:alpha').length, 0);

snapshot.value = makeSnapshot([
  ['s:5:gamma', 'gamma'],
  ['s:4:zero', 'zero'],
  ['s:5:alpha', 'alpha'],
]);
await nextTick();
assertOrder(container, 'data-id', ['s:5:gamma', 's:4:zero', 's:5:alpha']);
assertOrder(container, 'data-meta-id', ['s:5:gamma', 's:4:zero', 's:5:alpha']);
assert.equal(textOf(byDataId(container, 's:5:alpha')), 'alpha:2:hot');

snapshot.value = makeSnapshot([
  ['s:5:gamma', 'gamma'],
  ['s:4:zero', 'zero'],
  ['s:5:alpha', 'alpha-v2'],
]);
await nextTick();
assert.equal(textOf(byDataId(container, 's:5:alpha')), 'alpha-v2:2:hot');
assert.equal(lifecycle.filter(event => event === 'mount:s:5:alpha').length, 1);

snapshot.value = makeSnapshot([
  ['s:5:gamma', 'gamma'],
  ['s:4:zero', 'zero'],
  ['s:5:delta', 'delta'],
]);
await nextTick();
assert.equal(lifecycle.filter(event => event === 'dispose:s:5:alpha').length, 1);
assert.equal(textOf(byDataId(container, 's:5:delta')), 'delta:2:cold');

// Vue, like React/Preact, may re-run this Host-deferred body while keyed child
// component state survives. Invocation count is not a portable lifecycle invariant.
assert.ok((renderCalls.get('s:5:alpha') ?? 0) > 1);
assert.equal(lifecycle.filter(event => event === 'mount:s:5:alpha').length, 1);

const nestedContainer = rootNode();
const nestedSnapshot = ref(makeNestedSnapshot([
  ['s:5:alpha', 'alpha', [
    ['s:9:alpha-one', 'alpha-one'],
    ['s:9:alpha-two', 'alpha-two'],
  ]],
  ['s:4:beta', 'beta', [
    ['s:8:beta-one', 'beta-one'],
  ]],
]));
const nestedApp = renderer.createApp({
  setup: () => () => repetitionHost(() => nestedSnapshot.value, nestedRenderGroup),
});
nestedApp.mount(nestedContainer);
await nextTick();
assert.equal(textOf(byDataId(nestedContainer, 's:5:alpha/s:9:alpha-one')), 'alpha-one:0:cold');
await click(nestedContainer, 's:5:alpha/s:9:alpha-one');
assert.equal(textOf(byDataId(nestedContainer, 's:5:alpha/s:9:alpha-one')), 'alpha-one:0:hot');

nestedSnapshot.value = makeNestedSnapshot([
  ['s:4:beta', 'beta-v2', [
    ['s:8:beta-one', 'beta-one-v2'],
  ]],
  ['s:5:alpha', 'alpha-v2', [
    ['s:9:alpha-two', 'alpha-two-v2'],
    ['s:9:alpha-one', 'alpha-one-v2'],
  ]],
]);
await nextTick();
assertOrder(nestedContainer, 'data-outer-id', ['s:4:beta', 's:5:alpha']);
assert.equal(textOf(byDataId(nestedContainer, 's:5:alpha/s:9:alpha-one')), 'alpha-one-v2:1:hot');
assert.equal(lifecycle.filter(event => event === 's:5:alpha/dispose:s:9:alpha-one').length, 0);

nestedSnapshot.value = makeNestedSnapshot([
  ['s:4:beta', 'beta-v3', [
    ['s:8:beta-one', 'beta-one-v3'],
  ]],
]);
await nextTick();
assert.equal(lifecycle.filter(event => event === 's:5:alpha/dispose:s:9:alpha-one').length, 1);
assert.equal(lifecycle.filter(event => event === 's:5:alpha/dispose:s:9:alpha-two').length, 1);

app.unmount();
await nextTick();
for (const id of ['s:5:gamma', 's:4:zero', 's:5:delta']) {
  assert.equal(lifecycle.filter(event => event === `dispose:${id}`).length, 1);
}
assert.equal(lifecycle.filter(event => event === 'dispose:s:4:beta').length, 1);
assert.equal(lifecycle.filter(event => event === 'dispose:s:5:alpha').length, 1);

nestedApp.unmount();
await nextTick();
assert.equal(lifecycle.filter(event => event === 's:4:beta/dispose:s:8:beta-one').length, 1);

console.log('Vue repetition host prototype: PASS');
