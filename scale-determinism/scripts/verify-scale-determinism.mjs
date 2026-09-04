import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  return `import js { accept, consume } from "./library.js"\n\nfn callback${String(index).padStart(3, '0')}(value: Float) -> Float {\n  return value\n}\n\npub fn run${String(index).padStart(3, '0')}() -> Unit uses JavaScript {\n  discard accept("${name}-a")\n  discard consume(callback${String(index).padStart(3, '0')})\n  discard accept("${name}-b")\n  discard consume(callback${String(index).padStart(3, '0')})${suffix}\n  return Unit\n}\n`;
}

function mainSource() {
  const imports = [];
  const calls = [];
  for (let index = 0; index < WORKER_COUNT; index++) {
    const suffix = String(index).padStart(3, '0');
    imports.push(`import { run${suffix} } from "./${workerName(index)}.virune"`);
    calls.push(`  discard run${suffix}()`);
  }
  return `${imports.join('\n')}\n\npub fn main() -> Unit uses JavaScript {\n${calls.join('\n')}\n  return Unit\n}\n`;
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
  await writeFile(join(sourceDirectory, 'library.d.ts'), baselineDeclaration, 'utf8');
  await writeFile(join(sourceDirectory, 'library.js'), [
    'export function accept(value) { void value; }',
    'export function consume(callback) { callback(1); }',
    '',
  ].join('\n'), 'utf8');
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
  const modules = result.modules.map(module => ({
    path: relative(root, module.source.path).replaceAll('\\', '/'),
    code: module.output?.code ?? null,
    operations: module.semantic === undefined ? [] : externalOperationSequence(module.semantic),
  })).sort((left, right) => compareText(left.path, right.path));
  return { errors, modules };
}

function operationCounts(snapshot) {
  const operations = snapshot.modules.flatMap(module => module.operations);
  const calls = operations.filter(operation => operation.kind === 'call');
  const callableCalls = calls.filter(operation => (operation.callableProjections?.length ?? 0) > 0);
  return { calls: calls.length, callableCalls: callableCalls.length };
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
  const equivalent = await freshBuild(equivalentRoot, 1);
  assert.deepEqual(equivalent, baseline, 'equivalent absolute roots must produce identical code and External operation evidence');
  assert.equal(baseline.modules.length, WORKER_COUNT + 1, 'generated module count drifted');
  assert.deepEqual(operationCounts(baseline), {
    calls: WORKER_COUNT * CALLS_PER_WORKER,
    callableCalls: WORKER_COUNT * CALLABLE_CALLS_PER_WORKER,
  }, 'generated External call fixture drifted');
  await assertCliOutputMatches(firstRoot, baseline);

  const incremental = new IncrementalProjectBuilder();
  activeProvider = provider(firstRoot, 1);
  const incrementalFirstResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const incrementalFirst = canonicalResult(incrementalFirstResult, firstRoot);
  assert.deepEqual(incrementalFirst, baseline);
  assert.equal(activeProvider.cachedImportCount, WORKER_COUNT * 2, 'unexpected distinct JS import cache cardinality');

  const unchangedResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const unchanged = canonicalResult(unchangedResult, firstRoot);
  assert.deepEqual(unchanged, baseline, 'unchanged incremental build must equal clean baseline');
  assert.ok(unchangedResult.stats.reusedCheckedModules >= WORKER_COUNT + 1, 'unchanged incremental build did not prove checked-module reuse');

  await writeFile(
    join(firstRoot, 'src', `${workerName(MUTATED_WORKER)}.virune`),
    workerSource(MUTATED_WORKER, true),
    'utf8',
  );
  const mutatedIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const mutatedIncremental = canonicalResult(mutatedIncrementalResult, firstRoot);
  const mutatedFresh = await freshBuild(firstRoot, 1);
  assert.deepEqual(mutatedIncremental, mutatedFresh, 'implementation-only edit retained stale incremental output/evidence');
  assert.notDeepEqual(mutatedIncremental, baseline, 'implementation-only edit was not observable');
  assert.ok(mutatedIncrementalResult.stats.checkedModules >= 1, 'changed worker was not rechecked');
  assert.ok(mutatedIncrementalResult.stats.reusedCheckedModules >= WORKER_COUNT, 'unaffected modules were not reused after implementation-only edit');

  await writeFile(
    join(firstRoot, 'src', `${workerName(MUTATED_WORKER)}.virune`),
    workerSource(MUTATED_WORKER),
    'utf8',
  );
  const sourceRestoredResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  assert.deepEqual(canonicalResult(sourceRestoredResult, firstRoot), baseline, 'restored Virune source did not recover canonical baseline');

  await writeFile(join(firstRoot, 'src', 'library.d.ts'), incompatibleDeclaration, 'utf8');
  disposeProvider(activeProvider);
  activeProvider = provider(firstRoot, 2);
  const incompatibleIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const incompatibleIncremental = canonicalResult(incompatibleIncrementalResult, firstRoot, { allowErrors: true });
  const incompatibleFresh = await freshBuild(firstRoot, 2, { allowErrors: true });
  assert.ok(incompatibleIncremental.errors.length >= WORKER_COUNT, 'incompatible declaration did not fail closed across generated workers');
  assert.deepEqual(incompatibleIncremental.errors, incompatibleFresh.errors, 'rotated provider generation disagreed with fresh declaration diagnostics');
  assert.equal(incompatibleIncrementalResult.stats.reusedCheckedModules, 0, 'provider generation change reused stale checked evidence');

  await writeFile(join(firstRoot, 'src', 'library.d.ts'), baselineDeclaration, 'utf8');
  disposeProvider(activeProvider);
  activeProvider = provider(firstRoot, 3);
  const recoveredIncrementalResult = await incremental.build(firstRoot, { write: false, jsInteropProvider: activeProvider });
  const recoveredIncremental = canonicalResult(recoveredIncrementalResult, firstRoot);
  const recoveredFresh = await freshBuild(firstRoot, 3);
  assert.equal(recoveredIncrementalResult.stats.reusedCheckedModules, 0, 'restored provider generation reused stale checked evidence');
  assert.deepEqual(recoveredIncremental, recoveredFresh, 'recovered incremental result differs from fresh build');
  assert.deepEqual(recoveredIncremental, baseline, 'restored declaration did not recover the original canonical baseline');

  process.stdout.write(
    `Verified ${WORKER_COUNT + 1} generated modules, ${WORKER_COUNT * CALLS_PER_WORKER} typed External calls, equivalent-root determinism, incremental parity, provider-generation invalidation, and recovery.\n`,
  );
} finally {
  if (activeProvider !== undefined) disposeProvider(activeProvider);
  await rm(firstRoot, { recursive: true, force: true });
  await rm(equivalentRoot, { recursive: true, force: true });
}
