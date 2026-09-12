import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { h, render } from 'preact';

const projectRoot = resolve('frontend-authoring');
const emitted = resolve(projectRoot, 'dist/app.jsx');
const emittedMap = `${emitted}.map`;
const transformed = resolve(projectRoot, 'dist/app.transformed.mjs');
const transformedMap = `${transformed}.map`;

const emittedCode = await readFile(emitted, 'utf8');
const sourceMap = JSON.parse(await readFile(emittedMap, 'utf8'));
assert.match(emittedCode, /export function App\(\$props\)/u);
assert.match(emittedCode, /export function Panel\(\$props\)/u);
assert.match(emittedCode, /<button onClick=\{\$viruneProjectCallable\(handle,/u);
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

globalThis.window = dom.window;
globalThis.document = dom.window.document;

try {
	const frontend = await import(pathToFileURL(transformed).href);
	assert.equal(typeof frontend.App, 'function');

	const appVNode = frontend.App({ title: 'Jobs', ready: true });
	assert.equal(appVNode.type, 'main');
	const appChildren = Array.isArray(appVNode.props.children) ? appVNode.props.children : [appVNode.props.children];
	const buttonVNode = appChildren.find(child => child && typeof child === 'object' && child.type === 'button');
	assert.ok(buttonVNode);
	assert.equal(typeof buttonVNode.props.onClick, 'function');
	assert.equal(buttonVNode.props.onClick(), true);

	render(h(frontend.App, { title: 'Jobs', ready: true }), root);
	const main = root.querySelector('main.page');
	assert.ok(main);
	assert.equal(main.getAttribute('data-kind'), 'jobs');
	assert.equal(main.querySelector('h1')?.textContent, 'Jobs');
	assert.equal(main.querySelector('button')?.textContent, 'Run');
	assert.equal(main.querySelector('.status')?.textContent, 'ready');
	assert.equal(main.querySelector('.panel h2')?.textContent, 'Queue');
	const items = [...main.querySelectorAll('li')];
	assert.deepEqual(items.map(item => item.textContent), ['compile', 'ship']);
	assert.deepEqual(items.map(item => item.getAttribute('data-index')), ['0', '1']);

	render(h(frontend.App, { title: 'Jobs', ready: false }), root);
	assert.equal(root.querySelector('.status'), null);
	assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['compile', 'ship']);
} finally {
	render(null, root);
	dom.window.close();
	delete globalThis.window;
	delete globalThis.document;
}

console.log('golden:frontend-authoring:ok');
