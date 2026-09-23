import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const projectRoot = resolve('frontend-authoring');
const emitted = resolve(projectRoot, 'dist/app.jsx');
const emittedMap = `${emitted}.map`;
const transformed = resolve(projectRoot, 'dist/app.transformed.mjs');
const transformedMap = `${transformed}.map`;
const browserBundle = resolve(projectRoot, 'dist/app.browser.min.mjs');
const browserBundleMap = `${browserBundle}.map`;

const installedLockPath = resolve('node_modules/.package-lock.json');
let installedLock;
try {
	installedLock = JSON.parse(await readFile(installedLockPath, 'utf8'));
} catch {
	installedLock = undefined;
}
console.log('diagnostic use-async integrity:', installedLock?.packages?.['node_modules/use-async']?.integrity ?? 'not found');

const emittedCode = await readFile(emitted, 'utf8');
const sourceMap = JSON.parse(await readFile(emittedMap, 'utf8'));
assert.match(emittedCode, /export function App\(\$props\)/u);
assert.match(emittedCode, /export function EffectProbe\(\$props\)/u);
assert.match(emittedCode, /export function RouteProbe\(\$props\)/u);
assert.match(emittedCode, /export function RouterApp\(\$props\)/u);
assert.match(emittedCode, /export function QueryProbe\(\$props\)/u);
assert.match(emittedCode, /from "react-router"/u);
assert.match(emittedCode, /from "use-async"/u);
assert.match(emittedCode, /useAsync\(/u);
assert.match(emittedCode, /useLocation\(\)/u);
assert.match(emittedCode, /useNavigate\(\)/u);
assert.match(emittedCode, /React\.useEffect\(\$viruneProjectCallable\(installEffect,/u);
assert.match(emittedCode, /React\.useEffect\(\$viruneProjectCallable\(installEffect,[^\n]*virune-callable-shim[^\n]*v3/u);
assert.match(emittedCode, /return \$viruneProjectCallable\(\$result,/u);
assert.doesNotMatch(emittedCode, /React\.useEffect\(installEffect\)/u);
assert.ok(emittedCode.endsWith('//# sourceMappingURL=app.jsx.map\n'));
assert.equal(sourceMap.file, 'app.jsx');
assert.ok(sourceMap.sources.some(source => source.endsWith('src/app.virune')));

await rm(transformed, { force: true });
await rm(transformedMap, { force: true });
await build({
	entryPoints: [emitted],
	outfile: transformed,
	bundle: false,
	format: 'esm',
	platform: 'node',
	target: 'node24',
	jsx: 'automatic',
	jsxImportSource: 'react',
	sourcemap: 'external',
	logLevel: 'silent',
});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="router-root"></div><div id="query-root"></div></body></html>');
const rootElement = dom.window.document.getElementById('root');
const routerRootElement = dom.window.document.getElementById('router-root');
const queryRootElement = dom.window.document.getElementById('query-root');
assert.ok(rootElement);
assert.ok(routerRootElement);
assert.ok(queryRootElement);

const lifecycle = [];
const originalConsoleLog = console.log;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
console.log = (...args) => {
	if (args.length === 1 && (args[0] === 'golden:react:effect' || args[0] === 'golden:react:cleanup')) lifecycle.push(args[0]);
	else originalConsoleLog(...args);
};

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: dom.window.navigator,
});
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let reactRoot;
let routerRoot;
let queryRoot;
let unmounted = false;
let routerUnmounted = false;
let queryUnmounted = false;
try {
	const [{ createRoot }, frontend] = await Promise.all([
		import('react-dom/client'),
		import(pathToFileURL(transformed).href),
	]);
	assert.equal(typeof frontend.App, 'function');
	assert.equal(typeof frontend.EffectProbe, 'function');
assert.equal(typeof frontend.QueryProbe, 'function');

	reactRoot = createRoot(rootElement);
	await act(async () => {
		reactRoot.render(createElement(frontend.App, { title: 'Jobs', ready: true }));
	});
	assert.deepEqual(lifecycle, ['golden:react:effect']);
	const main = rootElement.querySelector('main.page');
	assert.ok(main);
	assert.equal(main.getAttribute('data-kind'), 'react');
	assert.equal(main.querySelector('h1')?.textContent, 'Jobs');
	assert.equal(main.querySelector('.effect-probe')?.textContent, 'effect');
	assert.equal(main.querySelector('.status')?.textContent, 'ready');

	await act(async () => {
		reactRoot.render(createElement(frontend.App, { title: 'Jobs', ready: false }));
	});
	assert.deepEqual(lifecycle, ['golden:react:effect', 'golden:react:cleanup', 'golden:react:effect']);
	assert.equal(rootElement.querySelector('.status'), null);

	routerRoot = createRoot(routerRootElement);
	await act(async () => {
		routerRoot.render(createElement(frontend.RouterApp));
	});
	assert.equal(routerRootElement.querySelector('.route-path')?.textContent, '/');
	const navigateButton = routerRootElement.querySelector('#navigate');
	assert.ok(navigateButton);
	await act(async () => {
		navigateButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
	});
	assert.equal(routerRootElement.querySelector('.route-path')?.textContent, '/next');

	queryRoot = createRoot(queryRootElement);
	await act(async () => {
		queryRoot.render(createElement(frontend.QueryProbe));
	});
	assert.equal(queryRootElement.querySelector('#query-success-pending')?.textContent, 'loading');
	assert.equal(queryRootElement.querySelector('#query-success-pending')?.getAttribute('data-loading'), 'true');
	assert.equal(queryRootElement.querySelector('#query-failure-pending')?.textContent, 'loading');
	assert.equal(queryRootElement.querySelector('#query-failure-pending')?.getAttribute('data-loading'), 'true');
	assert.equal(queryRootElement.querySelector('#query-success-result')?.getAttribute('data-loading'), 'true');
	assert.equal(queryRootElement.querySelector('#query-success-result')?.getAttribute('data-value'), null);
	assert.equal(queryRootElement.querySelector('#query-failure-error')?.getAttribute('data-loading'), 'true');
	assert.equal(queryRootElement.querySelector('#query-failure-error')?.getAttribute('data-error'), null);

	async function waitForQueryState(predicate, description) {
		const deadline = Date.now() + 3000;
		while (!predicate()) {
			assert.ok(Date.now() < deadline, `timed out waiting for ${description}`);
			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 10));
			});
		}
	}

	await waitForQueryState(
		() => queryRootElement.querySelector('#query-success-result')?.getAttribute('data-value') === 'query:loaded',
		'success data',
	);
	assert.equal(queryRootElement.querySelector('#query-success-result')?.getAttribute('data-loading'), 'false');
	assert.equal(queryRootElement.querySelector('#query-success-pending')?.getAttribute('data-loading'), 'false');
	await waitForQueryState(
		() => queryRootElement.querySelector('#query-failure-error')?.getAttribute('data-error') !== null,
		'rejected error state',
	);
	assert.ok(queryRootElement.querySelector('#query-failure-error')?.getAttribute('data-error'));
	assert.equal(queryRootElement.querySelector('#query-failure-error')?.getAttribute('data-loading'), 'false');
	assert.equal(queryRootElement.querySelector('#query-failure-pending')?.getAttribute('data-loading'), 'false');

	await act(async () => {
		queryRoot.unmount();
	});
	queryUnmounted = true;

	await act(async () => {
		routerRoot.unmount();
	});
	routerUnmounted = true;

	await act(async () => {
		reactRoot.unmount();
	});
	unmounted = true;
	assert.deepEqual(lifecycle, ['golden:react:effect', 'golden:react:cleanup', 'golden:react:effect', 'golden:react:cleanup']);
} finally {
	if (queryRoot !== undefined && !queryUnmounted) {
		await act(async () => {
			queryRoot.unmount();
		});
	}
	if (routerRoot !== undefined && !routerUnmounted) {
		await act(async () => {
			routerRoot.unmount();
		});
	}
	if (reactRoot !== undefined && !unmounted) {
		await act(async () => {
			reactRoot.unmount();
		});
	}
	console.log = originalConsoleLog;
	dom.window.close();
	delete globalThis.IS_REACT_ACT_ENVIRONMENT;
	delete globalThis.HTMLElement;
	delete globalThis.Node;
	if (originalNavigatorDescriptor === undefined) delete globalThis.navigator;
	else Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
	delete globalThis.document;
	delete globalThis.window;
}

await rm(browserBundle, { force: true });
await rm(browserBundleMap, { force: true });
const browserBuild = await build({
	entryPoints: [emitted],
	outfile: browserBundle,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	jsx: 'automatic',
	jsxImportSource: 'react',
	sourcemap: 'external',
	minify: true,
	metafile: true,
	logLevel: 'silent',
});

const browserCode = await readFile(browserBundle, 'utf8');
const browserSourceMap = JSON.parse(await readFile(browserBundleMap, 'utf8'));
assert.ok(browserCode.length > 0);
assert.ok(browserSourceMap.sources.some(source => source.endsWith('src/app.virune')));
for (const output of Object.values(browserBuild.metafile.outputs)) {
	assert.equal(
		output.imports.some(entry => entry.external && (
			entry.path === 'react' ||
			entry.path.startsWith('react/') ||
			entry.path === 'react-router' ||
			entry.path.startsWith('react-router/') ||
			entry.path === 'use-async' ||
			entry.path.startsWith('use-async/')
		)),
		false,
	);
}

console.log('golden:react-frontend-authoring:ok');
