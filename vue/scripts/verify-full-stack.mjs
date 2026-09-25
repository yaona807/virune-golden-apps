import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { transformAsync } from '@babel/core';
import vueJsxPlugin from '@vue/babel-plugin-jsx';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFullStackServer } from '../../multi-layer/scripts/start-full-stack.mjs';

const fullStackRoot = resolve('full-stack');
const sourcePath = resolve(fullStackRoot, 'src/app.virune');
const emittedPath = resolve(fullStackRoot, 'dist/app.jsx');
const emittedCode = await readFile(emittedPath, 'utf8');
const emittedMap = JSON.parse(await readFile(`${emittedPath}.map`, 'utf8'));
const transformedPath = resolve(fullStackRoot, 'dist/app.transformed.mjs');
const transformedMapPath = `${transformedPath}.map`;
const browserSource = resolve(fullStackRoot, 'browser');
const browserOutput = resolve(fullStackRoot, 'dist/browser');
const sourceText = await readFile(sourcePath, 'utf8');
const browserMain = await readFile(resolve(browserSource, 'main.js'), 'utf8');
const browserFiles = await readdir(browserSource);

assert.match(sourceText, /internal component App\(initialStatus: String\)/u);
assert.match(sourceText, /return view \{/u);
assert.match(sourceText, /form\(method: "post", action: "\/jobs\/job-42"\)/u);
assert.match(emittedCode, /export function App\(\$props\)/u);
assert.match(emittedCode, /initialStatus/u);
assert.ok(emittedMap.sources.some(item => item.endsWith('src/app.virune')));
assert.doesNotMatch(browserMain, /\bfetch\s*\(|XMLHttpRequest|axios/u);
assert.ok(!browserFiles.includes('api.js'), 'the browser must not contain a handwritten API adapter');

await rm(transformedPath, { force: true });
await rm(transformedMapPath, { force: true });
const babelResult = await transformAsync(emittedCode, {
	filename: emittedPath,
	babelrc: false,
	configFile: false,
	inputSourceMap: emittedMap,
	sourceMaps: true,
	sourceType: 'module',
	plugins: [vueJsxPlugin],
});
assert.ok(babelResult?.code && babelResult.map);
assert.doesNotMatch(babelResult.code, /<\/?(?:main|h1|p|form|button)(?:\s|>)/u);
assert.match(babelResult.code, /createVNode/u);
await writeFile(transformedPath, `${babelResult.code}\n//# sourceMappingURL=app.transformed.mjs.map\n`);
await writeFile(transformedMapPath, `${JSON.stringify(babelResult.map)}\n`);
assert.ok(babelResult.map.sources.some(item => item.endsWith('src/app.virune')));

await rm(browserOutput, { recursive: true, force: true });
const browserBuild = await build({
	entryPoints: [resolve(browserSource, 'main.js')],
	outdir: browserOutput,
	entryNames: 'main',
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	sourcemap: 'external',
	minify: true,
	metafile: true,
	logLevel: 'silent',
});
const bundle = await readFile(resolve(browserOutput, 'main.js'), 'utf8');
const bundleMap = JSON.parse(await readFile(resolve(browserOutput, 'main.js.map'), 'utf8'));
const outputs = Object.values(browserBuild.metafile.outputs);
assert.ok(bundle.length > 0);
assert.ok((await readFile(resolve(browserOutput, 'main.css'), 'utf8')).length > 0);
assert.ok(bundleMap.sources.some(item => item.endsWith('src/app.virune')));
assert.ok(outputs.some(output => output.entryPoint?.endsWith('/browser/main.js')));
assert.equal(outputs.some(output => output.imports.some(item => item.external)), false);

const databasePath = resolve('multi-layer-full-stack.sqlite');
await rm(databasePath, { force: true });
let server;
let browser;
try {
	server = await startFullStackServer();
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const pageErrors = [];
	const consoleErrors = [];
	const browserApiCalls = [];
	const postResponses = [];
	page.on('pageerror', error => pageErrors.push(error.message));
	page.on('console', message => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('request', request => {
		if (['fetch', 'xhr'].includes(request.resourceType())) browserApiCalls.push(request.url());
	});
	page.on('response', response => {
		if (response.request().method() === 'POST') postResponses.push(response.status());
	});

	const response = await page.goto(server.url, { waitUntil: 'networkidle' });
	assert.equal(response?.status(), 200);
	await page.locator('main.job-page').waitFor({ state: 'visible' });
	assert.equal(await page.locator('#job-status').textContent(), 'queued:preview');
	assert.equal(await page.locator('#job-status').getAttribute('data-status'), 'queued:preview');
	assert.equal(await page.locator('form').getAttribute('method'), 'post');
	assert.equal(await page.locator('form').getAttribute('action'), '/jobs/job-42');
	assert.equal(
		await page.locator('main.job-page').evaluate(element => getComputedStyle(element).backgroundColor),
		'rgb(245, 248, 252)',
	);

	const navigation = page.waitForNavigation({ waitUntil: 'networkidle' });
	await page.locator('#publish-job').click();
	const redirectedResponse = await navigation;
	assert.equal(redirectedResponse?.status(), 200);
	assert.equal(new URL(page.url()).pathname, '/');
	assert.equal(postResponses.length, 1);
	assert.equal(postResponses[0], 303);
	assert.equal(await page.locator('#job-status').textContent(), 'completed:published');

	const persisted = await page.request.get(new URL('/jobs/job-42', server.url).href);
	assert.equal(persisted.status(), 200);
	assert.equal(await persisted.text(), 'completed:published');
	const missingGet = await page.request.get(new URL('/jobs/missing', server.url).href);
	assert.equal(missingGet.status(), 404);
	assert.equal(await missingGet.text(), 'missing:missing');
	const missingPost = await page.request.post(new URL('/jobs/missing', server.url).href);
	assert.equal(missingPost.status(), 404);
	assert.equal(await missingPost.text(), 'missing:missing');
	const duplicatePost = await page.request.post(new URL('/jobs/job-42', server.url).href);
	assert.equal(duplicatePost.status(), 409);
	assert.equal(await duplicatePost.text(), 'completed:published');
	assert.deepEqual(browserApiCalls, [], 'the browser component must rely on the native form request');
	assert.deepEqual(pageErrors, []);
	assert.deepEqual(consoleErrors, []);

	process.stdout.write('golden:vue-full-stack-browser:ok\n');
} finally {
	await browser?.close();
	await server?.close();
	await rm(databasePath, { force: true });
}

const finalMap = await readFile(resolve(browserOutput, 'main.js.map'), 'utf8');
assert.ok(JSON.parse(finalMap).sources.some(item => item.endsWith('src/app.virune')));
assert.ok(bundle.includes('sourceMappingURL=main.js.map'));
assert.equal(typeof startFullStackServer, 'function');
