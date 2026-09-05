import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.TZ = 'UTC';

const dateFnsManifest = JSON.parse(
	await readFile(resolve('node_modules/date-fns/package.json'), 'utf8'),
);
assert.equal(dateFnsManifest.version, '4.4.0');

const typescriptManifest = JSON.parse(
	await readFile(resolve('node_modules/typescript/package.json'), 'utf8'),
);
assert.equal(typescriptManifest.version, '6.0.3');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const environment = { ...process.env };

function runScript(script) {
	const run = spawnSync(npm, ['run', '--silent', script], {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: environment,
	});
	assert.equal(
		run.status,
		0,
		`${script} failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
	);
	return run.stdout.split(/\r?\n/u).filter(Boolean);
}

const expected = 'ecosystem:date-fns:2026-09-08:true';
runScript('reference');
const referenceModule = await import(pathToFileURL(resolve('.reference-dist/reference.js')).href);
const referenceResult = referenceModule.result;
assert.equal(referenceResult, expected, `unexpected TypeScript reference result: ${referenceResult}`);

const viruneLines = runScript('start');
const viruneResult = viruneLines.find(line => line.startsWith('ecosystem:date-fns:'));
assert.equal(viruneResult, expected, `unexpected Virune result: ${JSON.stringify(viruneLines)}`);
assert.equal(viruneResult, referenceResult, 'Virune and TypeScript observable results diverged');

process.stdout.write('PASS date-fns ecosystem differential: parseISO -> addDays -> format/isAfter.\n');
