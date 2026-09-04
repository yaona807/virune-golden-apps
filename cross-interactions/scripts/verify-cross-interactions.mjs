import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const virune = resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'virune.cmd' : 'virune',
);
const libraryDeclaration = await readFile(resolve('src/library.d.ts'), 'utf8');
const libraryRuntime = await readFile(resolve('src/library.js'), 'utf8');

const positive = spawnSync(npm, ['run', '--silent', 'start'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(
  positive.status,
  0,
  `cross-interaction runtime failed\nstdout:\n${positive.stdout}\nstderr:\n${positive.stderr}`,
);
const runtimeLine = positive.stdout
  .split(/\r?\n/u)
  .find(line => line.startsWith('golden:cross-interactions:'));
assert.equal(runtimeLine, 'golden:cross-interactions:b?:b!|a!');

async function createNegativeProject(prefix, source) {
  const root = await mkdtemp(join(tmpdir(), `virune-golden-cross-${prefix}-`));
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
  await writeFile(join(sourceDirectory, 'library.d.ts'), libraryDeclaration, 'utf8');
  await writeFile(join(sourceDirectory, 'library.js'), libraryRuntime, 'utf8');
  await writeFile(join(sourceDirectory, 'main.virune'), source, 'utf8');
  return root;
}

function checkProject(root) {
  return spawnSync(virune, ['check', root], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

const temporaryRoots = [];
try {
  const unknownRoot = await createNegativeProject('unknown-contextual', `import js { foreignValue, select } from "./library.js"

pub fn main() -> Unit uses JavaScript {
  let foreign: Unknown = foreignValue()
  discard select({ kind: "unknown", value: foreign })
  return Unit
}
`);
  temporaryRoots.push(unknownRoot);
  const unknown = checkProject(unknownRoot);
  assert.equal(
    unknown.status,
    1,
    `Unknown contextual-object probe did not fail closed\nstdout:\n${unknown.stdout}\nstderr:\n${unknown.stderr}`,
  );
  const unknownDiagnostics = `${unknown.stdout}\n${unknown.stderr}`;
  assert.match(unknownDiagnostics, /error\[L4204\]/u);
  assert.match(unknownDiagnostics, /Cannot resolve JavaScript call/u);

  const nativeRoot = await createNegativeProject('native-aggregate', `import js { pass } from "./library.js"

record Config {
  value: String
}

pub fn main() -> Unit uses JavaScript {
  let config = Config { value: "x" }
  discard pass(config)
  return Unit
}
`);
  temporaryRoots.push(nativeRoot);
  const nativeAggregate = checkProject(nativeRoot);
  assert.equal(
    nativeAggregate.status,
    1,
    `native aggregate generic/unknown probe did not fail closed\nstdout:\n${nativeAggregate.stdout}\nstderr:\n${nativeAggregate.stderr}`,
  );
  const nativeDiagnostics = `${nativeAggregate.stdout}\n${nativeAggregate.stderr}`;
  assert.match(nativeDiagnostics, /error\[L4206\]/u);
  assert.match(nativeDiagnostics, /must be explicitly encoded before passing it to JavaScript/u);

  process.stdout.write(
    'Verified generic construct/contextual callback/index-write/receiver and discriminated-overload cross-interactions plus Unknown/native-aggregate fail-closed safety.\n',
  );
} finally {
  await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true })));
}
