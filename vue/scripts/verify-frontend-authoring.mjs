import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformAsync } from '@babel/core';
import vueJsxPlugin from '@vue/babel-plugin-jsx';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = resolve('frontend-authoring');
const source = await readFile(resolve(projectRoot, 'src/app.virune'), 'utf8');
const stateSource = await readFile(resolve(projectRoot, 'src/state.js'), 'utf8');
const emitted = resolve(projectRoot, 'dist/app.jsx');
const emittedCode = await readFile(emitted, 'utf8');
const sourceMap = JSON.parse(await readFile(`${emitted}.map`, 'utf8'));
const transformed = resolve(projectRoot, 'dist/app.transformed.mjs');
const transformedMap = `${transformed}.map`;
const browserBundle = resolve(projectRoot, 'dist/app.browser.min.mjs');
const browserBundleMap = `${browserBundle}.map`;

assert.match(source, /import js \{ computed, KeepAlive, ref \} from "vue"/u);
assert.match(source, /import js \{ state \} from "\.\/state\.js"/u);
assert.match(stateSource, /import \{ ref \} from 'vue'/u);
assert.match(emittedCode, /export function App\(\$props\)/u);
assert.match(emittedCode, /export function Metric\(\$props\)/u);
assert.match(emittedCode, /from "vue"/u);
assert.match(emittedCode, /from "\.\/state\.js"/u);
assert.ok(emittedCode.includes('<KeepAlive'));
assert.ok(emittedCode.includes('<Metric'));
assert.match(emittedCode, /onClick=\{\$viruneProjectCallable\(/u);
assert.match(emittedCode, /viewState\["value"\]/u);
assert.match(emittedCode, /state\["value"\]/u);
assert.ok(emittedCode.endsWith('//# sourceMappingURL=app.jsx.map\n'));
assert.equal(sourceMap.file, 'app.jsx');
assert.ok(sourceMap.sources.some(item => item.endsWith('src/app.virune')));

await rm(transformed, { force: true });
await rm(transformedMap, { force: true });
const babelResult = await transformAsync(emittedCode, {
	filename: emitted, babelrc: false, configFile: false, inputSourceMap: sourceMap,
	sourceMaps: true, sourceType: 'module', plugins: [vueJsxPlugin],
});
assert.ok(babelResult?.code && babelResult.map);
assert.doesNotMatch(babelResult.code, /<\/?(?:KeepAlive|Metric|main|button|output|p)(?:\s|>)/u);
assert.match(babelResult.code, /createVNode/u);
await writeFile(transformed, `${babelResult.code}\n//# sourceMappingURL=app.transformed.mjs.map\n`);
await writeFile(transformedMap, `${JSON.stringify(babelResult.map)}\n`);
assert.ok(babelResult.map.sources.some(item => item.endsWith('src/app.virune')));

await rm(browserBundle, { force: true });
await rm(browserBundleMap, { force: true });
const browserBuild = await build({
	entryPoints: [transformed], outfile: browserBundle, bundle: true, format: 'esm',
	platform: 'browser', target: 'es2022', sourcemap: 'external', minify: true,
	metafile: true, logLevel: 'silent',
});
const browserCode = await readFile(browserBundle, 'utf8');
const browserMap = JSON.parse(await readFile(browserBundleMap, 'utf8'));
assert.ok(browserCode.length > 0);
assert.ok(browserMap.sources.some(item => item.endsWith('src/app.virune')));
assert.ok(browserMap.sources.some(item => item.endsWith('state.js')));
for (const output of Object.values(browserBuild.metafile.outputs)) {
	assert.equal(output.imports.some(item => item.external), false);
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
const root = dom.window.document.getElementById('root');
assert.ok(root);
const names = ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment', 'DocumentFragment', 'ShadowRoot'];
const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name] });
let app;
let mounted = false;
try {
	const [{ createApp, nextTick }, frontend] = await Promise.all([import('vue'), import(pathToFileURL(transformed).href)]);
	assert.equal(typeof frontend.App, 'function');
	assert.equal(typeof frontend.Metric, 'function');
	app = createApp(frontend.App);
	app.mount(root);
	mounted = true;
	await nextTick();
	const read = selector => root.querySelector(selector);
	assert.equal(read('main.vue-page')?.getAttribute('data-framework'), 'vue');
	assert.equal(read('p.vue-count')?.textContent, 'before');
	assert.equal(read('p.vue-count')?.getAttribute('data-value'), 'before');
	assert.equal(read('output.vue-metric')?.textContent, 'before');
	assert.equal(read('button.vue-increment')?.textContent, 'update');
	read('button.vue-increment').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
	await nextTick();
	assert.equal(read('p.vue-count')?.textContent, 'after');
	assert.equal(read('p.vue-count')?.getAttribute('data-value'), 'after');
	assert.equal(read('output.vue-metric')?.textContent, 'after');
	assert.equal(read('output.vue-metric')?.getAttribute('data-value'), 'after');
} finally {
	if (mounted) app.unmount();
	for (const name of names) {
		const descriptor = previous.get(name);
		if (descriptor === undefined) delete globalThis[name];
		else Object.defineProperty(globalThis, name, descriptor);
	}
	dom.window.close();
}

console.log('golden:vue-jsx-frontend-authoring:ok');
