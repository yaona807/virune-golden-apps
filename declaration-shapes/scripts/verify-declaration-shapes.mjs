import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const nanoidManifest = JSON.parse(
	await readFile(resolve('node_modules/nanoid/package.json'), 'utf8'),
);
assert.equal(nanoidManifest.version, '6.0.1');
assert.equal(nanoidManifest.type, 'module');
assert.equal(nanoidManifest.types, './index.d.ts');
assert.equal(nanoidManifest.engines?.node, '^22 || ^24 || >=26');
assert.equal(nanoidManifest.dependencies, undefined);

const nanoidDeclarations = await readFile(resolve('node_modules/nanoid/index.d.ts'), 'utf8');
assert.match(nanoidDeclarations, /export function customAlphabet<Type extends string>\(/u);
assert.match(nanoidDeclarations, /\): \(size\?: number\) => Type/u);

const msManifest = JSON.parse(
	await readFile(resolve('node_modules/ms/package.json'), 'utf8'),
);
assert.equal(msManifest.version, '2.1.3');
assert.equal(msManifest.main, './index');
assert.equal(msManifest.types, undefined);
assert.equal(msManifest.dependencies, undefined);

const msTypesManifest = JSON.parse(
	await readFile(resolve('node_modules/@types/ms/package.json'), 'utf8'),
);
assert.equal(msTypesManifest.version, '2.1.0');
assert.equal(msTypesManifest.dependencies, undefined);

const msDeclarations = await readFile(resolve('node_modules/@types/ms/index.d.ts'), 'utf8');
assert.match(msDeclarations, /declare function ms\(value: number, options\?: \{ long: boolean \}\): string;/u);
assert.match(msDeclarations, /declare function ms\(value: ms\.StringValue\): number;/u);
assert.match(msDeclarations, /`\$\{number\}`/u);
assert.match(msDeclarations, /export = ms;/u);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
});
assert.equal(
	run.status,
	0,
	`declaration-shape runtime scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);

const stdoutLines = run.stdout.split(/\r?\n/u).filter(Boolean);
const result = stdoutLines.find(line => line.startsWith('golden:declaration-shapes:'));
assert.ok(result, `missing declaration-shape runtime result: ${JSON.stringify(stdoutLines)}`);
assert.match(
	result,
	/^golden:declaration-shapes:[abc]{7}:[abc]{4}:7200000:1m$/u,
	`unexpected declaration-shape runtime result: ${result}`,
);

const broadString = spawnSync(npm, ['run', '--silent', 'check', '--', 'negative'], {
	cwd: process.cwd(),
	encoding: 'utf8',
});
assert.equal(
	broadString.status,
	1,
	`broad String template-literal probe did not fail closed\nstdout:\n${broadString.stdout}\nstderr:\n${broadString.stderr}`,
);
const broadStringDiagnostics = `${broadString.stdout}\n${broadString.stderr}`;
assert.match(broadStringDiagnostics, /error\[L4204\]/u);
assert.match(broadStringDiagnostics, /Cannot resolve JavaScript call/u);

process.stdout.write('Verified returned External callable, template-literal overloads, and broad String fail-closed behavior.\n');
