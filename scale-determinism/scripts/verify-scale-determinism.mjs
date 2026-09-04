import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  buildProject,
  externalOperationSequence,
  IncrementalProjectBuilder,
} from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '@virune/js-interop/cached-provider';

const WORKER_COUNT = 100;
const CALLS_PER_WORKER = 4;
const CALLABLE_CALLS_PER_WORKER = 2;
const MUTATED_WORKER = 50;
const ADDED_WORKER = WORKER_COUNT;
const PACKAGE_NAME = '@virune-golden/scale-runtime';
const BASELINE_RUNTIME_ENTRY = 'index.js';
const ALTERNATE_RUNTIME_ENTRY = 'alternate.js';
const CLI_TIMEOUT_MS = 5 * 60 * 1000;
const baselineDeclaration = [
  'export declare function accept(value: string): void;',
  'export declare function consume(callback: (value: number) => number): void;',
  '',
].join('\n');
const incompatibleDeclaration = [
  'export declare function accept(value: number): void;',
  'export declare function consume(callback: (value: number) => number): void;',
  '',
].join('\n');

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function workerName(index) {
  return `worker-${String(index).padStart(3, '0')}`;
}

function workerSource(index, mutated = false) {
  const name = workerName(index);
  const suffix = mutated ? '\n  discard accept("worker-mutated")' : '';
  return `import js { accept, consume } from "${PACKAGE_NAME}"\n\nfn callback${String(index).padStart(3, '0')}(value: Float) -> Float {\n  return value\n}\n\npub fn run${String(index).padStart(3, '0')}() -> Unit uses JavaScript {\n  discard accept("${name}-a")\n  discard consume(callback${String(index).padStart(3, '0')})\n  discard accept("${name}-b")\n  discard consume(callback${String(index).padStart(3, '0')})${suffix}\n  return Unit\n}\n`;
}

function mainSource(workerCount = WORKER_COUNT) {
  const imports = [];
  const calls = [];
  for (let index = 0; index < workerCount; index++) {
    const suffix = String(index).padStart(3, '0');
    imports.push(`import { run${suffix} } from "./${workerName(index)}.virune"`);
    calls.push(`  discard run${suffix}()`);
  }
  return `${imports.join('\n')}\n\npub fn main() -> Unit uses JavaScript {\n${calls.join('\n')}\n  return Unit\n}\n`;
}

function packageRoot(root) {
  return join(root, 'node_modules', '@virune-golden', 'scale-runtime');
}

function packageManifest(runtimeEntry) {
  return JSON.stringify({
    name: PACKAGE_NAME,
    version: '1.0.0',
    type: 'module',
    exports: {
      '.': {
        types: './index.d.ts',
        import: `./${runtimeEntry}`,
        default: `./${runtimeEntry}`,
      },
    },
  }, null, 2) + '\n';
}

async function writePackageManifest(root, runtimeEntry) {
  await writeFile(join(packageRoot(root), 'package.json'), packageManifest(runtimeEntry), 'utf8');
}

async function writePackageFixture(root) {
  const rootDirectory = packageRoot(root);
  await mkdir(rootDirectory, { recursive: true });
  await writePackageManifest(root, BASELINE_RUNTIME_ENTRY);
  await writeFile(join(rootDirectory, 'index.d.ts'), baselineDeclaration, 'utf8');
  const implementation = [
    'export function accept(value) { void value; }',
    'export function consume(callback) { callback(1); }',
    '',
  ].join('\n');
  await writeFile(join(rootDirectory, BASELINE_RUNTIME_ENTRY), implementation, 'utf8');
  await writeFile(join(rootDirectory, ALTERNATE_RUNTIME_ENTRY), implementation, 'utf8');
}

async function writeProject(root) {
  const sourceDirectory = join(root, 'src');
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
  await writeFile(join(root, 'virune.json'), JSON.stringify({
    languageVersion: '1.0',
    platform: 'node',
    sourceDir: 'src',
    outDir: 'dist',
    entry: 'src/main.virune',
    target: 'es2022',
    sourceMap: false,
    sourcesContent: false,
  }, null, 2) + '\n', 'utf8');
  await writePackageFixture(root);
  for (let index = 0; index < WORKER_COUNT; index++) {
    await writeFile(join(sourceDirectory, `${workerName(index)}.virune`), workerSource(index), 'utf8');
  }
  await writeFile(join(sourceDirectory, 'main.virune'), mainSource(), 'utf8');
}

function errorsOf(result) {
  return result.diagnostics
    .filter(item => item.severity === 'error')
    .map(item => ({ code: item.code, message: item.message, severity: item.severity }))
    .sort((left, right) => compareText(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`));
}

function canonicalResult(result, root, { allowErrors = false } = {}) {
  const errors = errorsOf(result);
  if (!allowErrors) assert.deepEqual(errors, [], 'generated project must be diagnostic-clean');
  const modules = result.modules.map(module => {
    const usageIR = module.semantic?.interop.usageIR ?? [];
    const operations = module.semantic === undefined ? [] : externalOperationSequence(module.semantic);
    assert.equal(JSON.stringify(usageIR).includes(root), false, `Usage IR leaked absolute project root for ${module.source.path}`);
    assert.equal(JSON.stringify(operations).includes(root), false, `External Operation evidence leaked absolute project root for ${module.source.path}`);
    assert.equal((module.output?.code ?? '').includes(root), false, `generated code leaked absolute project root for ${module.source.path}`);
    return {
      path: relative(root, module.source.path).replaceAll('\\', '/'),
      code: module.output?.code ?? null,
      usageIR,
      operations,
    };
  }).sort((left, right) => compareText(left.path, right.path));
  return { errors, modules };
}

function canonicalDigest(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function operationCounts(snapshot) {
  const operations = snapshot.modules.flatMap(module => module.operations);
  const calls = operations.filter(operation => operation.kind === 'call');
  const callableCalls = calls.filter(operation => (operation.callableProjections?.length ?? 0) > 0);
  return { calls: calls.length, callableCalls: callableCalls.length };
}

function packageRuntimeWitnesses(snapshot) {
  return snapshot.modules
    .flatMap(module => module.operations)
    .filter(operation => operation.kind === 'module-load' && operation.moduleSpecifier === PACKAGE_NAME)
    .map(operation => operation.runtimeWitness);
}

function assertRuntimeWitnesses(snapshot, runtimeEntry, workerCount) {
  const witnesses = packageRuntimeWitnesses(snapshot);
  assert.equal(witnesses.length, workerCount, `expected ${workerCount} package runtime witnesses`);
  for (const witness of witnesses) {
    assert.ok(witness, 'package ModuleLoad operation is missing runtime witness');
    assert.equal(witness.packageName, PACKAGE_NAME);
    assert.equal(witness.runtimeEntry, runtimeEntry);
    assert.equal(witness.runtimeFormat, 'esm');
    assert.equal(witness.platform, 'node');
    assert.ok(witness.packageJsonHash, 'package runtime witness is missing packageJsonHash');
  }
  const hashes = new Set(witnesses.map(witness => witness.packageJsonHash));
  assert.equal(hashes.size, 1, 'same package metadata produced multiple packageJsonHash values');
  return witnesses[0].packageJsonHash;
}

function assertBarePackageImports(snapshot) {
  const escaped = PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const packageImport = new RegExp(`from ["']${escaped}["']`, 'u');
  for (const module of snapshot.modules) {
    if (!module.path.includes('worker-') || module.code === null) continue;
    assert.match(module.code, packageImport, `${module.path} did not preserve bare package import`);
    assert.doesNotMatch(module.code, /(?:index|alternate)\.js/u, `${module.path} encoded package-internal runtime path`);
  }
}

function provider(root, generation) {
  return new CachedTypeScriptInteropProvider({ projectRoot: root, generation });
}

function disposeProvider(value) {
  value.dispose();
  assert.equal(value.cachedImportCount, 0, 'disposed provider generation must release cached imports');
}

async function freshBuild(root, generation, options = {}) {
  const value = provider(root, generation);
  try {
    const result = await buildProject(root, { write: false, jsInteropProvider: value });
    return canonicalResult(result, root, options);
  } finally {
    disposeProvider(value);
  }
}

function runCli(root, command) {
  const executable = resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'virune.cmd' : 'virune',
  );
  const result = spawnSync(executable, [command], {
    cwd: root,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    env: process.env,
  });
  assert.equal(
    result.status,
    0,
    `virune ${command} failed\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}\nerror:${result.error?.message ?? ''}`,
  );
}

async function assertCliOutputMatches(root, snapshot) {
  for (const module of snapshot.modules) {
    if (module.code === null || !module.path.startsWith('src/') || !module.path.endsWith('.virune')) continue;
    const emitted = join(root, 'dist', module.path.slice('src/'.length).replace(/\.virune$/u, '.js'));
    assert.equal(await readFile(emitted, 'utf8'), module.code, `CLI output differs for ${module.path}`);
  }
}

const firstRoot = await mkdtemp(join(tmpdir(), 'virune-golden-scale-a-'));
const equivalentRoot = await mkdtemp(join(tmpdir(), 'virune-golden-scale-b-'));
let activeProvider;
try {
  await writeProject(firstRoot);
  await writeProject(equivalentRoot);

  runCli(firstRoot, 'check');
  runCli(firstRoot, 'build');

  const baseline = await freshBuild(firstRoot, 1);
  const baselineDigest = canonicalDigest(baseline);
  const equivalent = await freshBuild(equivalentRoot, 1);
  assert.deepEqual(equivalent, baseline, 'equivalent absolute roots must produce identical canonical evidence');
  assert.equal(canonicalDigest(equivalent), baselineDigest, 'equivalent absolute roots produced different canonical digest');
  assert.equal(baseline.modules.length, WORKER_COUNT + 1, 'generated module count drifted');
  assert.deepEqual(operationCounts(baseline), {
    calls: WORKER_COUNT * CALLS_PER_WORKER,
    callableCalls: WORKER_COUNT * CALLABLE_CALLS_PER_WORKER,
  }, 'generated External call fixture drifted');
  const baselinePackageHash = assertRuntimeWitnesses(baseline, BASELINE_RUNTIME_ENTRY, WORKER_COUNT);
  assertBarePackageImports(baseline);
  await assertCliOutputMatches(firstRoot, baseline);

  const incremental = new IncrementalProjectBuilder();
  activeProvider = provider(firstRoot, 1);
  const incrementalFirstResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const incrementalFirst = canonicalResult(incrementalFirstResult, firstRoot);
  assert.deepEqual(incrementalFirst, baseline);
  assert.equal(canonicalDigest(incrementalFirst), baselineDigest);
  assert.equal(activeProvider.cachedImportCount, WORKER_COUNT * 2, 'unexpected distinct JS import cache cardinality');

  const unchangedResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const unchanged = canonicalResult(unchangedResult, firstRoot);
  assert.deepEqual(unchanged, baseline, 'unchanged incremental build must equal clean baseline');
  assert.equal(canonicalDigest(unchanged), baselineDigest);
  assert.ok(unchangedResult.stats.reusedCheckedModules >= WORKER_COUNT + 1, 'unchanged incremental build did not prove checked-module reuse');

  await writeFile(
    join(firstRoot, 'src', `${workerName(MUTATED_WORKER)}.virune`),
    workerSource(MUTATED_WORKER, true),
    'utf8',
  );
  const mutatedIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const mutatedIncremental = canonicalResult(mutatedIncrementalResult, firstRoot);
  const mutatedFresh = await freshBuild(firstRoot, 1);
  assert.deepEqual(mutatedIncremental, mutatedFresh, 'implementation-only edit retained stale incremental evidence');
  assert.equal(canonicalDigest(mutatedIncremental), canonicalDigest(mutatedFresh));
  assert.notEqual(canonicalDigest(mutatedIncremental), baselineDigest, 'implementation-only edit was not observable in canonical digest');
  assert.ok(mutatedIncrementalResult.stats.checkedModules >= 1, 'changed worker was not rechecked');
  assert.ok(mutatedIncrementalResult.stats.reusedCheckedModules >= WORKER_COUNT, 'unaffected modules were not reused after implementation-only edit');

  await writeFile(
    join(firstRoot, 'src', `${workerName(MUTATED_WORKER)}.virune`),
    workerSource(MUTATED_WORKER),
    'utf8',
  );
  const sourceRestoredResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const sourceRestored = canonicalResult(sourceRestoredResult, firstRoot);
  assert.deepEqual(sourceRestored, baseline, 'restored Virune source did not recover canonical baseline');
  assert.equal(canonicalDigest(sourceRestored), baselineDigest);

  await writeFile(
    join(firstRoot, 'src', `${workerName(ADDED_WORKER)}.virune`),
    workerSource(ADDED_WORKER),
    'utf8',
  );
  await writeFile(join(firstRoot, 'src', 'main.virune'), mainSource(WORKER_COUNT + 1), 'utf8');
  const addedIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const addedIncremental = canonicalResult(addedIncrementalResult, firstRoot);
  const addedFresh = await freshBuild(firstRoot, 1);
  assert.deepEqual(addedIncremental, addedFresh, 'module-add incremental result differs from fresh build');
  assert.equal(canonicalDigest(addedIncremental), canonicalDigest(addedFresh));
  assert.notEqual(canonicalDigest(addedIncremental), baselineDigest, 'module addition was not observable in canonical digest');
  assert.equal(addedIncremental.modules.length, WORKER_COUNT + 2, 'module addition did not change canonical module set');
  assert.deepEqual(operationCounts(addedIncremental), {
    calls: (WORKER_COUNT + 1) * CALLS_PER_WORKER,
    callableCalls: (WORKER_COUNT + 1) * CALLABLE_CALLS_PER_WORKER,
  }, 'module addition produced unexpected External call evidence');
  assertRuntimeWitnesses(addedIncremental, BASELINE_RUNTIME_ENTRY, WORKER_COUNT + 1);
  assert.ok(addedIncrementalResult.stats.checkedModules >= 2, 'module addition did not check added worker and entry');
  assert.ok(addedIncrementalResult.stats.reusedCheckedModules >= WORKER_COUNT, 'module addition did not reuse unaffected workers');

  await rm(join(firstRoot, 'src', `${workerName(ADDED_WORKER)}.virune`), { force: true });
  await writeFile(join(firstRoot, 'src', 'main.virune'), mainSource(), 'utf8');
  const deletedIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const deletedIncremental = canonicalResult(deletedIncrementalResult, firstRoot);
  const deletedFresh = await freshBuild(firstRoot, 1);
  assert.deepEqual(deletedIncremental, deletedFresh, 'module-delete incremental result differs from fresh build');
  assert.deepEqual(deletedIncremental, baseline, 'module delete/revert retained stale module evidence');
  assert.equal(canonicalDigest(deletedIncremental), baselineDigest, 'module delete/revert did not recover baseline digest');
  assert.ok(deletedIncrementalResult.stats.invalidatedModules >= 1, 'module deletion did not invalidate pruned module state');

  await writePackageManifest(firstRoot, ALTERNATE_RUNTIME_ENTRY);
  disposeProvider(activeProvider);
  activeProvider = provider(firstRoot, 2);
  const metadataIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const metadataIncremental = canonicalResult(metadataIncrementalResult, firstRoot);
  const metadataFresh = await freshBuild(firstRoot, 2);
  assert.deepEqual(metadataIncremental, metadataFresh, 'package-metadata mutation incremental result differs from fresh build');
  assert.equal(canonicalDigest(metadataIncremental), canonicalDigest(metadataFresh));
  assert.notEqual(canonicalDigest(metadataIncremental), baselineDigest, 'package-metadata mutation was not observable in canonical digest');
  assert.equal(metadataIncrementalResult.stats.reusedCheckedModules, 0, 'package-metadata provider generation reused stale checked evidence');
  const alternatePackageHash = assertRuntimeWitnesses(metadataIncremental, ALTERNATE_RUNTIME_ENTRY, WORKER_COUNT);
  assert.notEqual(alternatePackageHash, baselinePackageHash, 'package metadata mutation did not change packageJsonHash');
  assertBarePackageImports(metadataIncremental);

  await writePackageManifest(firstRoot, BASELINE_RUNTIME_ENTRY);
  disposeProvider(activeProvider);
  activeProvider = provider(firstRoot, 3);
  const metadataRestoredResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const metadataRestored = canonicalResult(metadataRestoredResult, firstRoot);
  const metadataRestoredFresh = await freshBuild(firstRoot, 3);
  assert.equal(metadataRestoredResult.stats.reusedCheckedModules, 0, 'restored package metadata provider generation reused stale checked evidence');
  assert.deepEqual(metadataRestored, metadataRestoredFresh, 'restored package metadata incremental result differs from fresh build');
  assert.deepEqual(metadataRestored, baseline, 'restored package metadata did not recover canonical baseline');
  assert.equal(canonicalDigest(metadataRestored), baselineDigest, 'restored package metadata did not recover baseline digest');
  assert.equal(assertRuntimeWitnesses(metadataRestored, BASELINE_RUNTIME_ENTRY, WORKER_COUNT), baselinePackageHash);

  await writeFile(join(packageRoot(firstRoot), 'index.d.ts'), incompatibleDeclaration, 'utf8');
  disposeProvider(activeProvider);
  activeProvider = provider(firstRoot, 4);
  const incompatibleIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const incompatibleIncremental = canonicalResult(incompatibleIncrementalResult, firstRoot, { allowErrors: true });
  const incompatibleFresh = await freshBuild(firstRoot, 4, { allowErrors: true });
  assert.ok(incompatibleIncremental.errors.length >= WORKER_COUNT, 'incompatible declaration did not fail closed across generated workers');
  assert.deepEqual(incompatibleIncremental, incompatibleFresh, 'rotated provider generation disagreed with fresh declaration evidence');
  assert.equal(canonicalDigest(incompatibleIncremental), canonicalDigest(incompatibleFresh));
  assert.notEqual(canonicalDigest(incompatibleIncremental), baselineDigest, 'declaration mutation was not observable in canonical digest');
  assert.equal(incompatibleIncrementalResult.stats.reusedCheckedModules, 0, 'provider generation change reused stale checked evidence');

  await writeFile(join(packageRoot(firstRoot), 'index.d.ts'), baselineDeclaration, 'utf8');
  disposeProvider(activeProvider);
  activeProvider = provider(firstRoot, 5);
  const recoveredIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const recoveredIncremental = canonicalResult(recoveredIncrementalResult, firstRoot);
  const recoveredFresh = await freshBuild(firstRoot, 5);
  assert.equal(recoveredIncrementalResult.stats.reusedCheckedModules, 0, 'restored provider generation reused stale checked evidence');
  assert.deepEqual(recoveredIncremental, recoveredFresh, 'recovered incremental result differs from fresh build');
  assert.deepEqual(recoveredIncremental, baseline, 'restored declaration did not recover the original canonical baseline');
  assert.equal(canonicalDigest(recoveredIncremental), baselineDigest, 'restored declaration did not recover baseline digest');

  process.stdout.write(
    `Verified ${WORKER_COUNT + 1} baseline modules, ${WORKER_COUNT * CALLS_PER_WORKER} typed External calls, canonical Usage IR/operation/runtime-witness/code digest parity, module add/delete recovery, package-metadata invalidation/recovery, declaration fail-closed recovery, and equivalent-root determinism.\n`,
  );
} finally {
  if (activeProvider !== undefined) disposeProvider(activeProvider);
  await rm(firstRoot, { recursive: true, force: true });
  await rm(equivalentRoot, { recursive: true, force: true });
}
