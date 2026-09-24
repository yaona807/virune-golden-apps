import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFrontendDevWorkflow } from './frontend-dev-workflow.mjs';

const sourcePath = resolve('frontend-authoring/src/app.virune');
const cssPath = resolve('frontend-authoring/browser/styles.css');
const sourceBefore = await readFile(sourcePath, 'utf8');
const cssBefore = await readFile(cssPath, 'utf8');
let workflow;
let browser;

async function waitForBuild(timeoutMs = 15_000) {
	let timer;
	try {
		return await Promise.race([
			new Promise(resolvePromise => workflow.events.once('build', resolvePromise)),
			new Promise((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('Virune watch rebuild timed out')), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

try {
	workflow = await startFrontendDevWorkflow();
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	const navigations = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('framenavigated', frame => {
		if (frame === page.mainFrame()) navigations.push(frame.url());
	});
	const response = await page.goto(workflow.url, { waitUntil: 'networkidle' });
	assert.equal(response?.status(), 200);
	await page.locator('main.vue-page').waitFor({ state: 'visible' });
	assert.equal(await page.locator('button.vue-increment').textContent(), 'update');
	assert.ok(await page.locator('#asset-probe').evaluate(image => image.complete && image.naturalWidth > 0));
	assert.equal(await page.locator('main.vue-page').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(245, 248, 252)');
	assert.equal(navigations.length, 1);

	const changedSource = sourceBefore.replace('"update"', '"refresh"');
	assert.notEqual(changedSource, sourceBefore, 'fixture must contain the expected Virune component label');
	const sourceBuild = waitForBuild();
	await writeFile(sourcePath, changedSource);
	const buildResult = await sourceBuild;
	assert.equal(buildResult.ok, true, `Virune watch rebuild failed: ${buildResult.error ?? buildResult.code}`);
	await page.waitForFunction(() => document.querySelector('button.vue-increment')?.textContent === 'refresh');
	await page.waitForFunction(() => window.__viruneHmrEvents?.includes('component-update'));
	assert.equal(navigations.length, 1, 'component update must not reload the browser document');

	const hmrEventsBeforeCss = await page.evaluate(() => window.__viruneHmrEvents.length);
	const changedCss = cssBefore.replace('rgb(245, 248, 252)', 'rgb(232, 239, 249)');
	assert.notEqual(changedCss, cssBefore, 'fixture must contain the expected CSS color');
	await writeFile(cssPath, changedCss);
	await page.waitForFunction(() => getComputedStyle(document.querySelector('main.vue-page')).backgroundColor === 'rgb(232, 239, 249)');
	await page.waitForFunction(count => window.__viruneHmrEvents?.length > count, hmrEventsBeforeCss);
	assert.equal(navigations.length, 1, 'CSS update must not reload the browser document');
	assert.deepEqual(errors, []);
	console.log('golden:vue-jsx-dev-watch-hmr:ok');
} finally {
	await browser?.close();
	await workflow?.close();
	await writeFile(sourcePath, sourceBefore);
	await writeFile(cssPath, cssBefore);
}
