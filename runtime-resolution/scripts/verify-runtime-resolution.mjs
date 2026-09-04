import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildProject, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '@virune/js-interop';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const projectRoot = process.cwd();

const evidenceBuild = await buildProject(projectRoot, {
  write: false,
  jsInteropProvider: new TypeScriptInteropProvider({ projectRoot }),
});
assert.deepEqual(
  evidenceBuild.diagnostics.filter(item => item.severity === 'error'),
  [],
  'runtime-resolution evidence build produced errors',
);
const mainModule = evidenceBuild.modules.find(item => item.source.path.endsWith('main.virune'));
assert.ok(mainModule?.semantic, 'runtime-resolution main module has no checked semantic evidence');
const moduleLoads = externalOperationSequence(mainModule.semantic)
  .filter(operation => operation.kind === 'module-load');

function runtimeWitness(moduleSpecifier) {
  const operation = moduleLoads.find(item => item.moduleSpecifier === moduleSpecifier);
  assert.ok(operation?.kind === 'module-load', `missing ModuleLoad evidence for ${moduleSpecifier}`);
  assert.ok(operation.runtimeWitness, `missing runtime witness for ${moduleSpecifier}`);
  const witness = operation.runtimeWitness;
  return {
    moduleSpecifier: witness.moduleSpecifier,
    packageName: witness.packageName,
    runtimeEntry: witness.runtimeEntry,
    runtimeFormat: witness.runtimeFormat,
    platform: witness.platform,
  };
}

assert.deepEqual(
  [
    runtimeWitness('@virune-golden/runtime-shapes'),
    runtimeWitness('@virune-golden/runtime-shapes/feature'),
    runtimeWitness('@virune-golden/runtime-shapes/legacy'),
  ],
  [
    {
      moduleSpecifier: '@virune-golden/runtime-shapes',
      packageName: '@virune-golden/runtime-shapes',
      runtimeEntry: 'runtime/node.mjs',
      runtimeFormat: 'esm',
      platform: 'node',
    },
    {
      moduleSpecifier: '@virune-golden/runtime-shapes/feature',
      packageName: '@virune-golden/runtime-shapes',
      runtimeEntry: 'runtime/feature-node.mjs',
      runtimeFormat: 'esm',
      platform: 'node',
    },
    {
      moduleSpecifier: '@virune-golden/runtime-shapes/legacy',
      packageName: '@virune-golden/runtime-shapes',
      runtimeEntry: 'runtime/legacy.cjs',
      runtimeFormat: 'commonjs',
      platform: 'node',
    },
  ],
  'compiler-owned runtime witnesses did not select the expected package branches',
);

const run = spawnSync(npm, ['run', '--silent', 'start'], {
  cwd: projectRoot,
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

process.stdout.write('Verified compiler runtime witnesses, conditional root/subpath branches, and ESM-to-CommonJS package loading.\n');
