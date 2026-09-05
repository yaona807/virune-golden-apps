import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import './jsdom-host.mjs';

const preactManifest = JSON.parse(
	await readFile(resolve('node_modules/preact/package.json'), 'utf8'),
);
const jsdomManifest = JSON.parse(
	await readFile(resolve('node_modules/jsdom/package.json'), 'utf8'),
);
const jsdomTypesManifest = JSON.parse(
	await readFile(resolve('node_modules/@types/jsdom/package.json'), 'utf8'),
);
assert.equal(preactManifest.version, '10.29.8');
assert.equal(jsdomManifest.version, '30.0.1');
assert.equal(jsdomTypesManifest.version, '30.0.0');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const hostImport = pathToFileURL(resolve('scripts/jsdom-host.mjs')).href;
const nodeOptions = [process.env.NODE_OPTIONS, `--import=${hostImport}`].filter(Boolean).join(' ');
const run = spawnSync(npm, ['run', '--silent', 'start'], {
	cwd: process.cwd(),
	encoding: 'utf8',
	env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
assert.equal(
	run.status,
	0,
	`Virune Media Jobs Preact scenario failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
);
const line = run.stdout.split(/\r?\n/u).find(item => item.startsWith('golden:preact:'));
assert.ok(line, `missing Preact Golden output: ${JSON.stringify(run.stdout)}`);
const parts = line.slice('golden:preact:'.length).split('|');
assert.equal(parts.length, 3, `malformed Preact Golden output: ${JSON.stringify(line)}`);
const [initialHtml, clickedHtml, updatedHtml] = parts;
assert.ok(initialHtml);
assert.ok(clickedHtml);
assert.ok(updatedHtml);
assert.match(initialHtml, /<button[^>]*id="job-action"[^>]*>queued<\/button>/u);
assert.match(initialHtml, /style="display: block;"/u);
assert.doesNotMatch(initialHtml, /data-clicked=/u);
assert.match(clickedHtml, /data-clicked="yes"/u);
assert.match(clickedHtml, />queued<\/button>/u);
assert.match(updatedHtml, /<button[^>]*id="job-updated"[^>]*>completed<\/button>/u);
assert.match(updatedHtml, /style="display: none;"/u);

const listenerLines = run.stdout
	.split(/\r?\n/u)
	.filter(item => item === 'golden:dom-listener:called');
assert.equal(
	listenerLines.length,
	1,
	`expected one Direct DOM listener invocation before removal and none after removal: ${JSON.stringify(run.stdout)}`,
);

const domLine = run.stdout.split(/\r?\n/u).find(item => item.startsWith('golden:dom:'));
assert.ok(domLine, `missing Direct DOM Golden output: ${JSON.stringify(run.stdout)}`);
const domParts = domLine.slice('golden:dom:'.length).split('|');
assert.equal(domParts.length, 3, `malformed Direct DOM Golden output: ${JSON.stringify(domLine)}`);
const [directHtml, selectedId, missingCount] = domParts;
assert.match(directHtml, /^<section[^>]*id="direct-root"[^>]*>/u);
assert.match(directHtml, /<button[^>]*id="direct-action"[^>]*data-state="ready"[^>]*data-selected="yes"[^>]*><\/button>/u);
assert.equal(selectedId, 'direct-action');
assert.equal(missingCount, '0');

const generated = await readFile(resolve('dist/main.js'), 'utf8');
const projectionCount = generated.match(/\$viruneProjectCallable\(/gu)?.length ?? 0;
assert.ok(projectionCount >= 2, `expected generated callable shims for Preact and Direct DOM handlers, got ${projectionCount}`);
assert.match(generated, /\$fn\(\$raw0, rootTaskContext\(\)\)/u);
assert.match(generated, /\([^)]*, \$lambdaCtx\d+ = rootTaskContext\(\)\) => \{/u);
assert.match(generated, /querySelectorAll/u);
assert.match(generated, /setAttribute/u);
assert.match(generated, /addEventListener/u);
assert.match(generated, /removeEventListener/u);

const golden = await import(`${pathToFileURL(resolve('dist/main.js')).href}?golden-preact`);
const replay = golden.runFrontend();
const [replayInitial, replayClicked, replayUpdated] = replay.split('|');
assert.match(replayInitial, />queued<\/button>/u);
assert.match(replayClicked, /data-clicked="yes"/u);
assert.match(replayUpdated, />completed<\/button>/u);
const directReplay = golden.runDirectDom();
const [replayDirectHtml, replaySelectedId, replayMissingCount] = directReplay.split('|');
assert.match(replayDirectHtml, /id="direct-root"/u);
assert.match(replayDirectHtml, /id="direct-action"/u);
assert.match(replayDirectHtml, /data-state="ready"/u);
assert.match(replayDirectHtml, /data-selected="yes"/u);
assert.equal(replaySelectedId, 'direct-action');
assert.equal(replayMissingCount, '0');

process.stdout.write('Verified Preact render/update plus Direct DOM query/create/read/write/tree operations and add/remove listener identity.\n');
