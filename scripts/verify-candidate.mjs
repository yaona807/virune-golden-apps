import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const releaseDirectory = resolve(process.argv[2] ?? '.candidate/virune-release');
const expectedPackages = [
	'@virune/compiler',
	'@virune/formatter',
	'@virune/js-interop',
	'@virune/runtime',
	'@virune/stdlib',
	'virune',
].sort();

const readJson = async file => JSON.parse(await readFile(resolve(releaseDirectory, file), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const publication = await readJson('PUBLICATION-MANIFEST.json');
const packageManifest = await readJson('MANIFEST.json');
const releaseManifest = await readJson('RELEASE-MANIFEST.json');

assert.equal(publication.schemaVersion, 1);
assert.equal(publication.publishSource, 'reviewed-release-registry-candidate-tarball');
assert.equal(packageManifest.schemaVersion, 1);
assert.equal(releaseManifest.schemaVersion, 2);
assert.equal(packageManifest.version, publication.version);
assert.equal(releaseManifest.version, publication.version);

const publicationPackages = [...publication.packages]
	.sort((left, right) => left.registryName.localeCompare(right.registryName));
assert.deepEqual(publicationPackages.map(item => item.registryName), expectedPackages);

const packageEntries = new Map(packageManifest.packages.map(item => [item.file, item]));
const releaseEntries = new Map(releaseManifest.files.map(item => [item.file, item]));

for (const item of publicationPackages) {
	assert.equal(typeof item.releaseAsset, 'string');
	assert.match(item.sha256, /^[0-9a-f]{64}$/u);
	assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0);

	const bytes = await readFile(resolve(releaseDirectory, item.releaseAsset));
	const actual = { sha256: digest(bytes), bytes: bytes.byteLength };
	assert.deepEqual(actual, { sha256: item.sha256, bytes: item.bytes });

	const packageEntry = packageEntries.get(item.releaseAsset);
	assert.ok(packageEntry, `MANIFEST.json is missing ${item.releaseAsset}`);
	assert.deepEqual({ sha256: packageEntry.sha256, bytes: packageEntry.bytes }, actual);

	const releaseEntry = releaseEntries.get(item.releaseAsset);
	assert.ok(releaseEntry, `RELEASE-MANIFEST.json is missing ${item.releaseAsset}`);
	assert.deepEqual({ sha256: releaseEntry.sha256, bytes: releaseEntry.bytes }, actual);

	const file = await stat(resolve(releaseDirectory, item.releaseAsset));
	assert.equal(file.isFile(), true);
}

process.stdout.write(`Verified ${publicationPackages.length} Virune consumer tarballs for ${publication.version}.\n`);
