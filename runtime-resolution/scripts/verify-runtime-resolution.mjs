import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = spawnSync(npm, ['run', '--silent', 'start'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(
  run.status,
  0,
  `runtime-resolution Golden runtime failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);

const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
assert.deepEqual(
  stdoutLines,
  ['golden:runtime-resolution:root:node:node|feature:node:feature|legacy:cjs:legacy'],
  `unexpected runtime-resolution output: ${JSON.stringify(stdoutLines)}`,
);
assert.doesNotMatch(run.stdout, /wrong-/u);
assert.doesNotMatch(run.stderr, /wrong-/u);

const generated = await readFile(resolve('dist/main.js'), 'utf8');
for (const specifier of [
  '@virune-golden/runtime-shapes',
  '@virune-golden/runtime-shapes/feature',
  '@virune-golden/runtime-shapes/legacy',
]) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  assert.match(
    generated,
    new RegExp(`from ["']${escaped}["']`, 'u'),
    `generated JavaScript did not preserve bare package specifier ${specifier}`,
  );
}
assert.doesNotMatch(
  generated,
  /(?:types\/(?:node|default|feature-node|feature-default|legacy)|runtime\/(?:node|default|feature-node|feature-default|legacy))\.(?:d\.(?:ts|cts)|mjs|cjs)/u,
  'generated JavaScript rewrote a package import to a package-internal declaration/runtime path',
);

process.stdout.write('Verified conditional root/subpath declaration and runtime branches plus ESM-to-CommonJS package loading.\n');
