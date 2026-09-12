import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import babel from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const { transformAsync } = babel;
const projectRoot = resolve('frontend-authoring');
const emitted = resolve(projectRoot, 'dist/app.jsx');
const emittedMap = `${emitted}.map`;
const transformed = resolve(projectRoot, 'dist/app.solid.mjs');
const transformedMap = `${transformed}.map`;
const browserBundle = resolve(projectRoot, 'dist/app.browser.min.mjs');
const browserBundleMap = `${browserBundle}.map`;

const emittedCode = await readFile(emitted, 'utf8');
const sourceMap = JSON.parse(await readFile(emittedMap, 'utf8'));
assert.match(emittedCode, /export function App\(\$props\)/u);
assert.match(emittedCode, /export function Row\(\$props\)/u);
assert.match(emittedCode, /itemsFor\([^;\n]*mode\(\)[^;\n]*\)/u);
assert.match(emittedCode, /<main class=\{"solid-page"\}>/u);
assert.doesNotMatch(emittedCode, /className/u);
assert.match(emittedCode, /onClick=\{\$viruneProjectCallable\(/u);
assert.ok(emittedCode.endsWith('//# sourceMappingURL=app.jsx.map\n'));
assert.equal(sourceMap.file, 'app.jsx');
assert.ok(sourceMap.sources.some(source => source.endsWith('src/app.virune')));

await rm(transformed, { force: true });
await rm(transformedMap, { force: true });
const solidTransform = await transformAsync(emittedCode, {
	filename: emitted,
	babelrc: false,
	configFile: false,
	presets: [[solidPreset, { generate: 'dom', hydratable: false }]],
	sourceMaps: true,
	inputSourceMap: sourceMap,
});
assert.ok(solidTransform?.code);
assert.ok(solidTransform.map);
assert.doesNotMatch(solidTransform.code, /<main[ >]/u);
assert.ok(solidTransform.map.sources.some(source => source.endsWith('src/app.virune')));
await writeFile(transformed, `${solidTransform.code}\n//# sourceMappingURL=${transformed.split('/').at(-1)}.map\n`);
await writeFile(transformedMap, `${JSON.stringify(solidTransform.map)}\n`);

await rm(browserBundle, { force: true });
await rm(browserBundleMap, { force: true });
const browserBuild = await build({
	stdin: {
		contents: `import { render } from 'solid-js/web';\nimport { App } from './app.solid.mjs';\nexport function mount(root) { return render(() => App({}), root); }\n`,
		resolveDir: dirname(transformed),
		sourcefile: 'solid-golden-host.mjs',
		loader: 'js',
	},
	outfile: browserBundle,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
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
		output.imports.some(entry => entry.external && (entry.path === 'solid-js' || entry.path.startsWith('solid-js/'))),
		false,
	);
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
	url: 'http://localhost/',
});
const root = dom.window.document.getElementById('root');
assert.ok(root);

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: dom.window.navigator,
});
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;

const rows = () => [...root.querySelectorAll('#items > li')];
const labels = () => rows().map(row => row.getAttribute('data-item'));
const indexes = () => rows().map(row => row.getAttribute('data-index'));
const texts = () => rows().map(row => row.querySelector('button.row')?.textContent);
const rowButton = label => root.querySelector(`#items > li[data-item="${label}"] button.row`);
const click = async selector => {
	const element = root.querySelector(selector);
	assert.ok(element, `missing element for ${selector}`);
	element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	await Promise.resolve();
};

let dispose;
try {
	const frontend = await import(`${pathToFileURL(browserBundle).href}?run=${Date.now()}`);
	assert.equal(typeof frontend.mount, 'function');
	dispose = frontend.mount(root);
	assert.equal(typeof dispose, 'function');

	assert.ok(root.querySelector('main.solid-page'));
	assert.deepEqual(labels(), ['alpha', 'beta']);
	assert.deepEqual(indexes(), ['0', '1']);
	assert.deepEqual(texts(), ['alpha:cold', 'beta:cold']);

	const initialAlpha = rowButton('alpha');
	assert.ok(initialAlpha);
	initialAlpha.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	await Promise.resolve();
	assert.equal(rowButton('alpha')?.textContent, 'alpha:hot');

	await click('#append');
	assert.deepEqual(labels(), ['alpha', 'beta', 'gamma']);
	assert.deepEqual(indexes(), ['0', '1', '2']);
	assert.equal(rowButton('alpha')?.textContent, 'alpha:hot');

	await click('#prepend');
	assert.deepEqual(labels(), ['zero', 'alpha', 'beta', 'gamma']);
	assert.deepEqual(indexes(), ['0', '1', '2', '3']);
	assert.equal(rowButton('alpha')?.textContent, 'alpha:hot');

	await click('#delete');
	assert.deepEqual(labels(), ['zero', 'alpha', 'gamma']);
	assert.deepEqual(indexes(), ['0', '1', '2']);
	assert.equal(rowButton('alpha')?.textContent, 'alpha:hot');

	await click('#reorder');
	assert.deepEqual(labels(), ['gamma', 'zero', 'alpha']);
	assert.deepEqual(indexes(), ['0', '1', '2']);
	assert.equal(rowButton('alpha')?.textContent, 'alpha:hot');
} finally {
	if (typeof dispose === 'function') dispose();
	dom.window.close();
	delete globalThis.MouseEvent;
	delete globalThis.Event;
	delete globalThis.HTMLElement;
	delete globalThis.Node;
	if (originalNavigatorDescriptor === undefined) delete globalThis.navigator;
	else Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
	delete globalThis.document;
	delete globalThis.window;
}

console.log('golden:solid-frontend-authoring:ok');
