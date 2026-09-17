import assert from 'node:assert/strict';
import { createRenderer, h, nextTick, ref } from 'vue';

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
    assert.notEqual(index, -1);
    parent.children.splice(index, 0, node);
  }
}

const renderer = createRenderer({
  patchProp(node, key, _previous, next) {
    if (next === null || next === undefined) delete node.props[key];
    else node.props[key] = next;
  },
  insert,
  remove: detach,
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
  parentNode: (node) => node.parent,
  nextSibling(node) {
    if (node.parent === null) return null;
    const siblings = node.parent.children;
    const index = siblings.indexOf(node);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  },
  querySelector: () => null,
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
  return entries.map(([id, label], index) => ({ id, index, value: { label } }));
}

const StatefulRow = {
  props: ['readValue', 'readIndex', 'id'],
  setup(props) {
    const mark = ref('cold');
    return () => h('button', {
      'data-id': props.id,
      onClick: () => { mark.value = 'hot'; },
    }, `${props.readValue().label}:${props.readIndex()}:${mark.value}`);
  },
};

function findById(node, id) {
  if (node.props?.['data-id'] === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

let bodyCalls = 0;
assert.throws(() => validateSnapshot(makeSnapshot([
  ['s:5:alpha', 'alpha'],
  ['s:5:alpha', 'alpha-copy'],
])).map((entry) => {
  bodyCalls += 1;
  return entry;
}), /duplicate repetition identity: s:5:alpha/);
assert.equal(bodyCalls, 0);

const root = rootNode();
const snapshot = ref(makeSnapshot([
  ['s:5:alpha', 'alpha'],
  ['s:4:beta', 'beta'],
]));
const app = renderer.createApp({
  setup: () => () => repetitionHost(
    () => snapshot.value,
    (readValue, readIndex, id) => {
      assert.equal(typeof readValue, 'function');
      assert.equal(typeof readIndex, 'function');
      return h(StatefulRow, { readValue, readIndex, id });
    },
  ),
});
app.mount(root);

const alpha = findById(root, 's:5:alpha');
assert.ok(alpha);
assert.equal(alpha.text, 'alpha:0:cold');
alpha.props.onClick();
await nextTick();
assert.equal(findById(root, 's:5:alpha')?.text, 'alpha:0:hot');

snapshot.value = makeSnapshot([
  ['s:4:beta', 'beta-v2'],
  ['s:5:alpha', 'alpha-v2'],
]);
await nextTick();
assert.equal(findById(root, 's:5:alpha')?.text, 'alpha-v2:1:hot');

app.unmount();
console.log('Vue repetition host call protocol: PASS');
