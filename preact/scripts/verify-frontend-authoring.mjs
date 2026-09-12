import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { h, render } from 'preact';
import { Suspense } from 'preact/compat';
import { act } from 'preact/test-utils';

const projectRoot = resolve('frontend-authoring');
const emitted = resolve(projectRoot, 'dist/app.jsx');
const emittedMap = `${emitted}.map`;
const transformed = resolve(projectRoot, 'dist/app.transformed.mjs');
const transformedMap = `${transformed}.map`;
const browserBundle = resolve(projectRoot, 'dist/app.browser.min.mjs');
const browserBundleMap = `${browserBundle}.map`;

const emittedCode = await readFile(emitted, 'utf8');
const sourceMap = JSON.parse(await readFile(emittedMap, 'utf8'));
assert.match(emittedCode, /export function App\(\$props\)/u);
assert.match(emittedCode, /export function Panel\(\$props\)/u);
assert.match(emittedCode, /export function EffectProbe\(\$props\)/u);
assert.match(emittedCode, /<button onClick=\{\$viruneProjectCallable\(handle,/u);
assert.match(emittedCode, /useEffect\(\$viruneProjectCallable\(installEffect,/u);
assert.match(emittedCode, /useEffect\(\$viruneProjectCallable\(installEffect,[^\n]*virune-callable-shim[^\n]*v3/u);
assert.match(emittedCode, /return \$viruneProjectCallable\(\$result,/u);
assert.doesNotMatch(emittedCode, /useEffect\(installEffect\)/u);
assert.match(emittedCode, /<Suspense fallback=\{"Loading"\}>/u);
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
	jsxImportSource: 'preact',
	sourcemap: 'external',
	logLevel: 'silent',
});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const root = dom.window.document.getElementById('root');
assert.ok(root);

const lifecycle = [];
const originalConsoleLog = console.log;
console.log = (...args) => {
	if (args.length === 1 && (args[0] === 'golden:effect' || args[0] === 'golden:cleanup')) lifecycle.push(args[0]);
	else originalConsoleLog(...args);
};

globalThis.window = dom.window;
globalThis.document = dom.window.document;

try {
	const frontend = await import(pathToFileURL(transformed).href);
	assert.equal(typeof frontend.App, 'function');
	assert.equal(typeof frontend.EffectProbe, 'function');

	const appVNode = frontend.App({ title: 'Jobs', ready: true });
	assert.equal(appVNode.type, 'main');
	const appChildren = Array.isArray(appVNode.props.children) ? appVNode.props.children : [appVNode.props.children];
	const buttonVNode = appChildren.find(child => child && typeof child === 'object' && child.type === 'button');
	assert.ok(buttonVNode);
	assert.equal(typeof buttonVNode.props.onClick, 'function');
	assert.equal(buttonVNode.props.onClick(), true);
	const suspenseVNode = appChildren.find(child => child && typeof child === 'object' && child.type === Suspense);
	assert.ok(suspenseVNode);
	assert.equal(suspenseVNode.props.fallback, 'Loading');

	await act(() => {
		render(h(frontend.App, { title: 'Jobs', ready: true }), root);
	});
	assert.deepEqual(lifecycle, ['golden:effect']);
	const main = root.querySelector('main.page');
	assert.ok(main);
	assert.equal(main.getAttribute('data-kind'), 'jobs');
	assert.equal(main.querySelector('h1')?.textContent, 'Jobs');
	assert.equal(main.querySelector('.effect-probe')?.textContent, 'effect');
	assert.equal(main.querySelector('.suspense-content')?.textContent, 'Loaded');
	assert.equal(main.querySelector('.status')?.textContent, 'ready');
	assert.equal(main.querySelector('.panel h2')?.textContent, 'Queue');
	const items = [...main.querySelectorAll('li')];
	assert.deepEqual(items.map(item => item.textContent), ['compile', 'ship']);
	assert.deepEqual(items.map(item => item.getAttribute('data-index')), ['0', '1']);

	await act(() => {
		render(h(frontend.App, { title: 'Jobs', ready: false }), root);
	});
	assert.deepEqual(lifecycle, ['golden:effect', 'golden:cleanup', 'golden:effect']);
	assert.equal(root.querySelector('.status'), null);
	assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['compile', 'ship']);

	await act(() => {
		render(null, root);
	});
	assert.deepEqual(lifecycle, ['golden:effect', 'golden:cleanup', 'golden:effect', 'golden:cleanup']);
} finally {
	render(null, root);
	console.log = originalConsoleLog;
	dom.window.close();
	delete globalThis.window;
	delete globalThis.document;
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
	jsxImportSource: 'preact',
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
		output.imports.some(entry => entry.external && (entry.path === 'preact' || entry.path.startsWith('preact/'))),
		false,
	);
}

console.log('golden:frontend-authoring:ok');
