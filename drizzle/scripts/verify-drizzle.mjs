import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const drizzleManifest = JSON.parse(
	await readFile(resolve('node_modules/drizzle-orm/package.json'), 'utf8'),
);
const sqliteManifest = JSON.parse(
	await readFile(resolve('node_modules/better-sqlite3/package.json'), 'utf8'),
);
const sqliteTypesManifest = JSON.parse(
	await readFile(resolve('node_modules/@types/better-sqlite3/package.json'), 'utf8'),
);
assert.equal(drizzleManifest.version, '0.45.2');
assert.equal(sqliteManifest.version, '13.0.3');
assert.equal(sqliteManifest.engines?.node, '>=22');
assert.equal(sqliteTypesManifest.version, '9.6.0');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
});
assert.equal(
	run.status,
	0,
	`Virune Media Jobs Drizzle scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);
const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
assert.ok(
	stdoutLines.includes('golden:drizzle:completed:1'),
	`unexpected Drizzle query result: ${JSON.stringify(stdoutLines)}`,
);

const generated = await readFile(resolve('dist/main.js'), 'utf8');
const projectionCount = generated.match(/\$viruneProjectCallable\(/gu)?.length ?? 0;
assert.ok(projectionCount >= 1, `expected generated callable shim for Drizzle transaction, got ${projectionCount}`);

const golden = await import(`${pathToFileURL(resolve('dist/main.js')).href}?golden-drizzle`);
assert.equal(golden.runDbSuccess(), 'completed:1');
assert.throws(
	() => golden.runDbConstraintFailure(),
	error => {
		if (!(error instanceof Error)) return false;
		assert.match(error.message, /UNIQUE constraint failed: jobs\.id/u);
		assert.equal('$tag' in error, false);
		assert.equal('$values' in error, false);
		return true;
	},
);

process.stdout.write('Verified Drizzle schema, insert, fluent select/where, External result indexing, transaction callback, and SQLite constraint failure.\n');
