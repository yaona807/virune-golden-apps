import assert from 'node:assert/strict';
import { createOptimizer } from '@builder.io/qwik/optimizer';

const source = String.raw`
import { component$, useSignal, useTask$ } from '@builder.io/qwik';

export const Probe = component$(() => {
  const state = useSignal('cold');
  useTask$(({ cleanup }) => {
    cleanup(() => console.log('probe cleanup'));
  });
  return <button>{state.value}</button>;
});
`;

const optimizer = await createOptimizer();
const output = await optimizer.transformModules({
  srcDir: '/src',
  input: [{ path: 'probe.tsx', code: source }],
  entryStrategy: { type: 'inline' },
  minify: 'none',
  sourceMaps: false,
  transpileTs: true,
  transpileJsx: true,
  preserveFilenames: true,
  explicitExtensions: true,
  mode: 'dev',
  isServer: false,
});

const errors = output.diagnostics.filter((diagnostic) => diagnostic.category === 'error' || diagnostic.category === 'sourceError');
assert.deepEqual(errors, []);
assert.ok(output.modules.length > 0);

for (const module of output.modules) {
  console.log(`Qwik optimizer module: ${module.path} entry=${module.isEntry}`);
  console.log(module.code);
}

console.log('Qwik optimizer probe: PASS');
