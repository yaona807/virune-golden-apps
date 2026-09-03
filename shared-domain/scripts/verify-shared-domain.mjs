import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const honoManifest = JSON.parse(
	await readFile(resolve('node_modules/hono/package.json'), 'utf8'),
);
const pQueueManifest = JSON.parse(
	await readFile(resolve('node_modules/p-queue/package.json'), 'utf8'),
);
assert.equal(honoManifest.version, '4.13.5');
assert.equal(pQueueManifest.version, '9.3.3');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
});
assert.equal(
	run.status,
	0,
	`Shared-domain Golden success scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);

const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
assert.ok(
	stdoutLines.includes('golden:shared-audit:completed:preview'),
	`native Console effect did not execute through the projected queue callback: ${JSON.stringify(stdoutLines)}`,
);
assert.ok(
	stdoutLines.includes('golden:shared-http:200:completed:preview|200:missing:missing'),
	`unexpected Hono/domain round trip: ${JSON.stringify(stdoutLines)}`,
);
assert.ok(
	stdoutLines.includes('golden:shared-queue:completed:preview'),
	`unexpected queue/domain result: ${JSON.stringify(stdoutLines)}`,
);

const generated = await readFile(resolve('dist/main.js'), 'utf8');
assert.doesNotMatch(generated, /\.add\(\s*queueWorker\s*\)/u);
assert.doesNotMatch(generated, /\.add\(\s*failingQueueWorker\s*\)/u);

const golden = await import(`${pathToFileURL(resolve('dist/main.js')).href}?golden-shared-domain`);
const httpResult = await golden.runHttpRoundTrip();
assert.equal(httpResult, '200:completed:preview|200:missing:missing');
assert.doesNotMatch(httpResult, /\$tag|\$values|\[object Object\]/u);

const queueResult = await golden.runQueueSuccess();
assert.equal(queueResult, 'completed:preview');
assert.doesNotMatch(queueResult, /\$tag|\$values|\[object Object\]/u);

await assert.rejects(
	golden.runQueueFailure(),
	error => {
		if (!(error instanceof Error)) return false;
		assert.equal(error.name, 'Error');
		assert.equal(error.message, 'Virune callback failed');
		assert.equal('code' in error, false);
		assert.equal('$tag' in error, false);
		assert.equal('$values' in error, false);
		assert.equal(String(error).includes('shared domain queue rejected'), false);
		assert.equal(String(error).includes('missing'), false);
		return true;
	},
);

process.stdout.write('Verified native shared domain across Hono and p-queue boundaries.\n');
