import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const releaseDirectory = resolve(process.argv[2] ?? '.candidate/virune-release');
const publication = JSON.parse(
	await readFile(resolve(releaseDirectory, 'PUBLICATION-MANIFEST.json'), 'utf8'),
);
const expectedPackages = [
	'@virune/compiler',
	'@virune/formatter',
	'@virune/js-interop',
	'@virune/runtime',
	'@virune/stdlib',
	'virune',
].sort();

const packages = [...publication.packages]
	.sort((left, right) => left.registryName.localeCompare(right.registryName));
assert.deepEqual(packages.map(item => item.registryName), expectedPackages);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(
	npm,
	[
		'install',
		'--no-save',
		'--package-lock=false',
		'--ignore-scripts',
		'--no-audit',
		'--no-fund',
		...packages.map(item => resolve(releaseDirectory, item.releaseAsset)),
	],
	{ cwd: process.cwd(), stdio: 'inherit' },
);
assert.equal(install.status, 0, 'exact Virune candidate installation failed');

for (const item of packages) {
	const packageRoot = resolve('node_modules', ...item.registryName.split('/'));
	const metadata = await lstat(packageRoot);
	assert.equal(metadata.isSymbolicLink(), false, `${item.registryName} must not be a workspace link`);
	assert.equal(metadata.isDirectory(), true);
	const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
	assert.equal(manifest.name, item.registryName);
	assert.equal(manifest.version, publication.version);
}

process.stdout.write(`Installed exact Virune ${publication.version} six-package consumer surface.\n`);
