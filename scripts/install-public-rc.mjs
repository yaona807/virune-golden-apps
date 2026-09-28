import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = process.env.VIRUNE_PUBLIC_VERSION;
assert.equal(version, '1.1.0-rc.4', 'this replay is pinned to public RC.4');

const registry = 'https://registry.npmjs.org/';
const packageNames = [
	'@virune/cli',
	'@virune/compiler',
	'@virune/formatter',
	'@virune/js-interop',
	'@virune/runtime',
	'@virune/stdlib',
].sort();
const installDirectory = resolve(process.argv[2] ?? process.cwd());
const packageSpecs = packageNames.map(name => name + '@' + version);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

process.stdout.write('Installing exact public Virune packages from ' + registry + '\n');
process.stdout.write(packageSpecs.join('\n') + '\n');

const install = spawnSync(
	npm,
	[
		'install',
		'--no-save',
		'--package-lock=false',
		'--no-audit',
		'--no-fund',
		'--registry=' + registry,
		...packageSpecs,
	],
	{
		cwd: installDirectory,
		stdio: 'inherit',
		env: { ...process.env, npm_config_registry: registry },
	},
);
assert.equal(install.status, 0, 'exact public Virune package installation failed');

for (const name of packageNames) {
	const packageRoot = resolve(installDirectory, 'node_modules', ...name.split('/'));
	const metadata = await lstat(packageRoot);
	assert.equal(metadata.isSymbolicLink(), false, name + ' must not be a workspace link');
	assert.equal(metadata.isDirectory(), true);

	const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
	assert.equal(manifest.name, name);
	assert.equal(manifest.version, version);
}

process.stdout.write(
	'Installed and verified all six public npm packages at ' + version + '.\n',
);
