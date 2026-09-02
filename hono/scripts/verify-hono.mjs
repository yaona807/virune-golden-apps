import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const honoManifest = JSON.parse(
	await readFile(resolve('node_modules/hono/package.json'), 'utf8'),
);
assert.equal(honoManifest.version, '4.13.5');
assert.equal(honoManifest.type, 'module');
assert.equal(honoManifest.engines?.node, '>=16.9.0');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
});
assert.equal(
	run.status,
	0,
	`Virune Media Jobs Hono scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);

const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
assert.ok(
	stdoutLines.includes('golden:hono:200:job-42:200:/health:200:query-42'),
	`unexpected Hono success/path/query result: ${JSON.stringify(stdoutLines)}`,
);
assert.ok(
	stdoutLines.includes('golden:hono-failure:500:Internal Server Error'),
	`unexpected Hono failure result: ${JSON.stringify(stdoutLines)}`,
);
assert.match(run.stderr, /Virune callback failed/u);
assert.doesNotMatch(run.stderr, /intentional Hono route failure/u);
assert.doesNotMatch(run.stderr, /\$tag|\$values/u);

const generated = await readFile(resolve('dist/main.js'), 'utf8');
const projectionCount = generated.match(/\$viruneProjectCallable\(/gu)?.length ?? 0;
assert.ok(projectionCount >= 4, `expected generated callable shims for Hono handlers, got ${projectionCount}`);
assert.doesNotMatch(generated, /\.get\([^,]+,\s*async\s*\(/u);

process.stdout.write('Verified Hono in-process HTTP success, path/query reads, contextual callbacks, and 500 failure boundary.\n');
