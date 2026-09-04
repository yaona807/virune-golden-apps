import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const expectedVersions = new Map([
	['better-sqlite3', '13.0.3'],
	['drizzle-orm', '0.45.2'],
	['hono', '4.13.5'],
	['jsdom', '30.0.1'],
	['p-queue', '9.3.3'],
	['preact', '10.29.8'],
	['@types/better-sqlite3', '9.6.0'],
	['@types/jsdom', '30.0.0'],
	['@types/node', '24.13.3'],
]);
for (const [name, version] of expectedVersions) {
	const manifest = JSON.parse(
		await readFile(resolve('node_modules', name, 'package.json'), 'utf8'),
	);
	assert.equal(manifest.version, version, `unexpected ${name} version`);
}

const expected = '1|1|0|queued:preview|200:completed:preview|404:missing:missing|<div id="job-state">completed:preview</div>';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const hostLoader = pathToFileURL(resolve('scripts/jsdom-host.mjs')).href;
const nodeOptions = [process.env.NODE_OPTIONS, `--import=${hostLoader}`].filter(Boolean).join(' ');
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
	env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
assert.equal(
	run.status,
	0,
	`Multi-layer Golden scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);
const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
assert.ok(
	stdoutLines.includes(`golden:multi-layer:${expected}`),
	`unexpected multi-layer runtime output: ${JSON.stringify(stdoutLines)}`,
);

const generated = await readFile(resolve('dist/main.js'), 'utf8');
const projectionOccurrences = generated.match(/\$viruneProjectCallable\(/gu)?.length ?? 0;
const projectionHelpers = generated.match(/function \$viruneProjectCallable\(/gu)?.length ?? 0;
assert.equal(projectionHelpers, 1, `expected one callable projection helper, got ${projectionHelpers}`);
const projectionCallCount = projectionOccurrences - projectionHelpers;
assert.equal(
	projectionCallCount,
	5,
	`expected five generated callback projection call sites for two row reductions, queue work, and two HTTP routes; got ${projectionCallCount}`,
);

await import(`${hostLoader}?multi-layer-host`);
const golden = await import(`${pathToFileURL(resolve('dist/main.js')).href}?golden-multi-layer`);
const directResult = await golden.runMultiLayer();
assert.equal(directResult, expected);
assert.doesNotMatch(directResult, /\$tag|\$values|\[object Object\]/u);

process.stdout.write('Verified exact DB row counts plus queued-to-completed state across DB, queue, native domain, HTTP, and UI boundaries.\n');
