import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pQueueManifest = JSON.parse(
	await readFile(resolve('node_modules/p-queue/package.json'), 'utf8'),
);
assert.equal(pQueueManifest.version, '9.3.3');
assert.equal(pQueueManifest.type, 'module');
assert.equal(pQueueManifest.engines?.node, '>=20');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
});
assert.equal(
	run.status,
	0,
	`Virune Media Jobs success scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);

const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
assert.equal(
	stdoutLines.filter(line => line === 'golden:active').length,
	2,
	`same handler must fire exactly twice before off(); stdout=${JSON.stringify(stdoutLines)}`,
);
assert.ok(
	stdoutLines.includes(
		'golden:result:preview-1:completed|poster-1:completed|waveform-1:completed',
	),
	`unexpected success result: ${JSON.stringify(stdoutLines)}`,
);

const generated = await readFile(resolve('dist/main.js'), 'utf8');
assert.doesNotMatch(generated, /\.on\([^,]+,\s*activeHandler\)/u);
assert.doesNotMatch(generated, /\.off\([^,]+,\s*activeHandler\)/u);
for (const worker of ['previewWorker', 'posterWorker', 'waveformWorker', 'failingWorker']) {
	assert.doesNotMatch(generated, new RegExp(`\\.add\\(\\s*${worker}\\s*\\)`, 'u'));
}

const golden = await import(`${pathToFileURL(resolve('dist/main.js')).href}?golden-p-queue`);
assert.equal(golden.configuredConcurrency(), 1);

await assert.rejects(
	golden.runFailure(),
	error => {
		if (!(error instanceof Error)) return false;
		assert.equal(error.name, 'Error');
		assert.equal(error.message, 'Virune callback failed');
		assert.equal('code' in error, false);
		assert.equal('$tag' in error, false);
		assert.equal('$values' in error, false);
		assert.equal(String(error).includes('intentional media job failure'), false);
		return true;
	},
);

process.stdout.write('Verified p-queue success, repeated callback identity, and rejection boundary.\n');
